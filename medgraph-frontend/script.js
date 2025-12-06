// script.js - final fixed version for MedGraph frontend

const GRAPH_URL = "http://localhost:3000/getFullGraph";

// -------------------- Helpers: normalize Neo4j integers / nested values --------------------
function isNeoInt(v) {
  return v && typeof v === "object" && (typeof v.toNumber === "function" || ("low" in v && "high" in v));
}
function normalizeValue(v) {
  if (isNeoInt(v)) {
    try {
      if (typeof v.toNumber === "function") return v.toNumber();
      if ("low" in v) return v.low;
    } catch (e) {}
  }
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = normalizeValue(v[k]);
    return out;
  }
  return v;
}
function normalizeProperties(props) {
  if (!props || typeof props !== 'object') return props || {};
  const out = {};
  for (const k of Object.keys(props)) out[k] = normalizeValue(props[k]);
  return out;
}

// -------------------- Small utilities --------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function toSafeNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
    const pi = parseInt(s, 10);
    if (!Number.isNaN(pi)) return pi;
    return null;
  }
  if (isNeoInt(v)) {
    try {
      if (typeof v.toNumber === "function") return v.toNumber();
      if ("low" in v) return v.low;
    } catch (e) {}
  }
  try {
    if (typeof v.valueOf === "function") {
      const x = v.valueOf();
      if (typeof x === "number" && !Number.isNaN(x)) return x;
      const n = Number(String(x));
      if (!Number.isNaN(n)) return n;
    }
  } catch (e) {}
  return null;
}

// -------------------- DOM elements --------------------
const graphContainer = document.getElementById("graph");
const statusEl = document.getElementById("status");
const nodeDetailsEl = document.getElementById("nodeDetails");
const btnRefresh = document.getElementById("btnRefresh");
const btnSearch = document.getElementById("btnSearch");
const searchInput = document.getElementById("searchInput");
const btnReset = document.getElementById("btnReset");
const btnAutoCluster = document.getElementById("btnAutoCluster");
const btnImportCsv = document.getElementById("btnImportCsv");
const csvFileInput = document.getElementById("csvFile");
const searchDropdown = document.getElementById("searchDropdown");
const btnRisk = document.getElementById("btnRisk");
const btnSimilarity = document.getElementById("btnSimilarity");
const relFilter = document.getElementById("filterRelType");

// -------------------- State --------------------
let network = null;
let visNodes = null;
let visEdges = null;
let originalNodes = [];
let originalEdges = [];

const LABEL_COLORS = {
  Drug: "#1f78ff",
  Disease: "#e7298a",
  Gene: "#33a02c",
  Symptom: "#ff9900",
  Organ: "#16a085",
  SideEffect: "#9b59b6",
  Patient: "#2b7bba"
};
function colorForLabel(label) { return LABEL_COLORS[label] || "#6c757d"; }
function setStatus(msg) { if (!statusEl) return; statusEl.textContent = msg || ""; }

// -------------------- Fetch graph from backend --------------------
async function fetchGraph() {
  setStatus("Loading graph...");
  try {
    const res = await fetch(GRAPH_URL);
    const data = await res.json();
    setStatus("");
    return data;
  } catch (err) {
    console.error("fetchGraph error:", err);
    setStatus("Failed to load graph");
    return null;
  }
}

// -------------------- Build vis.js nodes/edges --------------------
function buildVisData(data) {
  const nodeMap = new Map();
  const edges = [];
  const seenEdges = new Set();

  (data.nodes || []).forEach((n, idx) => {
    const rawProps = n.properties || {};
    const props = normalizeProperties(rawProps);

    const name = props.name || props.patientId || `node-${idx}`;
    const label = (n.labels && n.labels[0]) || "Entity";
    const id = `${label}::${name}`;

    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id, label: name, group: label,
        color: { background: colorForLabel(label) },
        _baseColor: colorForLabel(label),
        properties: props, value: 3
      });
    }
  });

  (data.relationships || []).forEach(r => {
    const startName = (r.start && (r.start.name || r.start.patientId || r.start.properties?.name || r.start.properties?.patientId)) || null;
    const endName = (r.end && (r.end.name || r.end.patientId || r.end.properties?.name || r.end.properties?.patientId)) || null;
    const type = r.type || r.label || "";

    const startId = startName ? [...nodeMap.keys()].find(k => k.endsWith(`::${startName}`)) : null;
    const endId = endName ? [...nodeMap.keys()].find(k => k.endsWith(`::${endName}`)) : null;

    if (startId && endId) {
      const key = `${startId}|${endId}|${type}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        const isSimilar = String(type).toUpperCase() === "SIMILAR_TO";
        edges.push({
          id: `edge-${edges.length}`,
          from: startId, to: endId, label: type,
          arrows: isSimilar ? "" : "to",
          color: isSimilar ? { color: "#ff3b3b", highlight: "#ff3b3b", hover: "#ff3b3b" } : undefined,
          width: isSimilar ? 3 : 1,
          smooth: isSimilar ? { type: "curvedCW", roundness: 0.35 } : false,
          font: { align: "middle", color: isSimilar ? "#ff3b3b" : "#000" }
        });
      }
    }
  });

  return { nodes: [...nodeMap.values()], edges };
}

// -------------------- Sidebar: node details --------------------
function showNodeDetails(nodeId) {
  const node = visNodes.get(nodeId);
  if (!node) { nodeDetailsEl.innerHTML = "<i>No details</i>"; return; }

  const label = node.group, name = node.label, props = node.properties || {};
  const risk = toSafeNumber(props.riskScore ?? props.risk ?? props.risk_level ?? null);
  const age = toSafeNumber(props.age ?? props.patientAge ?? null);

  let html = `<strong style="font-size:22px">${escapeHtml(name)}</strong><br/><small>Type: ${escapeHtml(label)}</small><hr/>`;

  if (label === "Patient") {
    if (risk !== null) {
      let color = "#2e7d32", text = "Low";
      if (risk >= 15) { color = "#c62828"; text = "High"; }
      else if (risk >= 8) { color = "#f9a825"; text = "Medium"; }
      html += `<div style="margin-bottom:10px"><span style="display:inline-block;padding:6px 10px;border-radius:12px;background:${color};color:#fff;font-weight:700">${text} RISK — ${escapeHtml(String(risk))}</span></div>`;
    }
    if (age !== null) html += `<div style="margin-bottom:6px"><b>Age:</b> ${escapeHtml(String(age))}</div>`;
    if (props.gender || props.sex) html += `<div><b>Gender:</b> ${escapeHtml(String(props.gender || props.sex))}</div>`;
    if (props.patientId) html += `<div><b>Patient ID:</b> ${escapeHtml(String(props.patientId))}</div>`;
  }

  // show other props
  const skip = new Set(['riskScore','risk','risk_level','age','patientAge','gender','sex','patientId','name','label']);
  const displayProps = Object.keys(props || {}).filter(k => !skip.has(k));
  if (displayProps.length) {
    html += `<b>Properties:</b><ul>`;
    displayProps.forEach(k => {
      const v = props[k];
      const show = (v === null || v === undefined) ? "Not Available" : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      html += `<li><b>${escapeHtml(k)}:</b> ${escapeHtml(show)}</li>`;
    });
    html += `</ul>`;
  }

  // connections
  const connected = visEdges.get({ filter: e => e.from === nodeId || e.to === nodeId }) || [];
  if (connected.length) {
    const related = { Drug: [], Disease: [], Gene: [], Symptom: [], Patient: [], SideEffect: [], Organ: [] };
    const raw = [];
    connected.forEach(e => {
      const other = e.from === nodeId ? e.to : e.from;
      const nn = visNodes.get(other);
      if (!nn) return;
      if (related[nn.group] && !related[nn.group].includes(nn.label)) related[nn.group].push(nn.label);
      raw.push(`${escapeHtml(name)} --[${escapeHtml(e.label || '')}]--> ${escapeHtml(nn.label)}`);
    });

    function section(title, arr) {
      if (!arr || arr.length === 0) return "";
      return `<div style="margin-bottom:8px"><b>${escapeHtml(title)}</b><ul>${arr.map(a=>`<li>${escapeHtml(a)}</li>`).join("")}</ul></div>`;
    }

    if (label === "Patient") {
      html += section("Diseases:", related.Disease);
      html += section("Drugs prescribed:", related.Drug);
      html += section("Genes of interest:", related.Gene);
      const similarList = related.Patient.filter(p => p !== name);
      html += section("Similar to:", similarList);
    } else if (label === "Disease") {
      html += section("Patients with this disease:", related.Patient);
      html += section("Drugs that treat:", related.Drug);
      html += section("Symptoms:", related.Symptom);
      html += section("Genes associated:", related.Gene);
    } else if (label === "Drug") {
      html += section("Treats:", related.Disease);
      html += section("Side effects:", related.SideEffect);
      html += section("Interacts with genes:", related.Gene);
    } else {
      html += section("Linked diseases:", related.Disease);
      html += section("Linked drugs:", related.Drug);
      html += section("Linked patients:", related.Patient);
    }

    html += `<hr/><b>Raw connections</b><div style="max-height:150px;overflow:auto;font-size:12px">${raw.map(r=>`<div>${r}</div>`).join("")}</div>`;
  }

  nodeDetailsEl.innerHTML = html;
}

// -------------------- Layout helpers --------------------
function cleanLayout() {
  if (!network) return;
  network.setOptions({
    physics: {
      barnesHut: {
        gravitationalConstant: -20000,
        centralGravity: 0.2,
        springLength: 160,
        springConstant: 0.01,
        avoidOverlap: 1
      },
      stabilization: { iterations: 200, updateInterval: 25 }
    }
  });
  network.stabilize();
  setTimeout(() => network.fit(), 700);
}
function resetLayout() {
  if (!visNodes) return;

  // Re-enable physics and clear any fixed positions and visual highlights
  if (network) network.setOptions({ physics: { enabled: true } });

  const updates = visNodes.get().map(n => ({
    id: n.id,
    fixed: { x: false, y: false },
    color: { background: n._baseColor || colorForLabel(n.group) },
    size: n.size ? n.size : 32,
    borderWidth: 1
  }));
  visNodes.update(updates);

  // Ensure edges back to normal width/color
  visEdges.get().forEach(e => {
    visEdges.update({ id: e.id, color: e._originalColor || e.color, width: e._originalWidth || (e.width || 1) });
  });

  network.fit();
}

// -------------------- Cluster patients around disease --------------------
function clusterPatients(diseaseId) {
  resetLayout();
  const rels = visEdges.get({ filter: e => e.from === diseaseId || e.to === diseaseId });
  const patientIds = rels.map(e => e.from === diseaseId ? e.to : e.from).filter(id => visNodes.get(id)?.group === "Patient");
  if (!patientIds.length) return alert("No patients linked to this disease");
  visNodes.update({ id: diseaseId, x:0, y:0, fixed: true });
  const R = 220;
  const step = (2 * Math.PI) / patientIds.length;
  const updates = patientIds.map((pid, i) => ({ id: pid, x: Math.round(R*Math.cos(i*step)), y: Math.round(R*Math.sin(i*step)), fixed: true, color: { background: colorForLabel("Patient") } }));
  visNodes.update(updates);
  // Keep physics off so cluster stays put
  network.setOptions({ physics: { enabled: false } });
  network.fit({ nodes: [diseaseId, ...patientIds] });
}

// -------------------- Auto cluster --------------------
function autoCluster() {
  const groups = Object.keys(LABEL_COLORS);
  groups.forEach(group => {
    network.cluster({
      joinCondition: function(nodeOptions) {
        return nodeOptions.group === group;
      },
      clusterNodeProperties: {
        id: 'cluster-' + group, label: group + 's', borderWidth: 2, shape: 'box', color: { background: LABEL_COLORS[group] }
      }
    });
  });
}

// -------------------- Render whole graph --------------------
async function render() {
  const data = await fetchGraph();
  if (!data) return;

  const visData = buildVisData(data);
  originalNodes = visData.nodes.slice();
  originalEdges = visData.edges.slice();

  visNodes = new vis.DataSet(visData.nodes);
  visEdges = new vis.DataSet(visData.edges);

  // store original edge visuals (for reset)
  visEdges.get().forEach(e => {
    if (!e._originalColor) e._originalColor = e.color;
    if (!e._originalWidth) e._originalWidth = e.width || 1;
  });

  // Color patients by risk if available
  visNodes.forEach(n => {
    if (n.group === "Patient" && n.properties) {
      const r = toSafeNumber(n.properties.riskScore ?? n.properties.risk ?? null);
      let bg = n._baseColor || colorForLabel("Patient");
      if (r !== null) {
        bg = "#2e7d32";
        if (r >= 15) bg = "#c62828";
        else if (r >= 8) bg = "#f9a825";
      }
      visNodes.update({ id: n.id, color: { background: bg } });
    }
  });

  // Defensive: clear any accidental fixed flags on freshly created nodes
  visNodes.get().forEach(n => {
    if (n.fixed && (n.fixed.x || n.fixed.y)) {
      visNodes.update({ id: n.id, fixed: { x: false, y: false } });
    }
  });

  const options = {
    layout: { improvedLayout: true },
    physics: {
      stabilization: true,
      barnesHut: { gravitationalConstant: -16000, centralGravity: 0.18, springLength: 180, springConstant: 0.01, avoidOverlap: 1.0 }
    },
    nodes: { shape: 'dot', size: 32, font: { color: '#fff', size: 16 } },
    edges: { arrows: 'to', smooth: { enabled: false }, font: { size: 13 } },
    groups: Object.fromEntries(Object.keys(LABEL_COLORS).map(k => [k, { color: { background: LABEL_COLORS[k] } }]))
  };

  if (network) network.destroy();
  network = new vis.Network(graphContainer, { nodes: visNodes, edges: visEdges }, options);

  network.on('click', params => {
    if (params.nodes && params.nodes.length) {
      const id = params.nodes[0];
      const n = visNodes.get(id);
      network.focus(id, { scale: 1.8, animation: { duration: 420 }});
      if (n && n.group === 'Disease') clusterPatients(id);
      showNodeDetails(id);
    } else {
      resetLayout();
      nodeDetailsEl.innerHTML = "<i>Click a node to see details</i>";
    }
  });

  // fit to make sure nodes are visible
  network.fit();
  setStatus("");
  prepareSearchDropdown();
}

// -------------------- Search dropdown/autocomplete --------------------
function prepareSearchDropdown() {
  if (!visNodes) return;
  searchDropdown.style.display = 'none';
}

searchInput.addEventListener('input', () => {
  const q = (searchInput.value || '').trim().toLowerCase();
  if (!q) { searchDropdown.style.display = 'none'; return; }
  const matches = visNodes.get().filter(n => (n.label && n.label.toLowerCase().includes(q)) || (n.properties?.patientId && String(n.properties.patientId).toLowerCase().includes(q)));
  if (!matches.length) { searchDropdown.style.display = 'none'; return; }
  searchDropdown.innerHTML = matches.slice(0, 20).map(n => `<li data-id="${n.id}">${escapeHtml(n.label)} <small style="color:#888">(${escapeHtml(n.group)})</small></li>`).join('');
  searchDropdown.style.display = 'block';
});

searchDropdown.addEventListener('click', ev => {
  const li = ev.target.closest('li');
  if (!li) return;
  const id = li.dataset.id;
  if (id) {
    network.selectNodes([id]);
    network.focus(id, { scale: 1.65, animation: { duration: 400 }});
    const original = visNodes.get(id);
    visNodes.update({ id, size: (original.size || 32) + 12, borderWidth: 6 });
    setTimeout(() => visNodes.update({ id, size: original.size || 32, borderWidth: 1 }), 1400);
    showNodeDetails(id);
    searchDropdown.style.display = 'none';
    searchInput.value = '';
  }
});

// -------------------- Search button (robust) --------------------
btnSearch.addEventListener('click', () => {
  const q = (searchInput.value || '').trim().toLowerCase();
  if (!q) return alert("Enter a search query");

  const all = visNodes.get();
  const found = all.find(n =>
    (n.label && n.label.toLowerCase() === q) ||
    (n.label && n.label.toLowerCase().includes(q)) ||
    (n.id && n.id.toLowerCase().includes(q)) ||
    (n.properties?.patientId && String(n.properties.patientId).toLowerCase() === q)
  );

  if (!found) {
    alert("No node found");
    return;
  }

  network.selectNodes([found.id]);
  network.focus(found.id, { scale: 1.8, animation: { duration: 500 }});

  const original = visNodes.get(found.id);
  visNodes.update({ id: found.id, size: (original.size || 32) + 12, borderWidth: 6 });
  setTimeout(() => visNodes.update({ id: found.id, size: original.size || 32, borderWidth: 1 }), 1500);

  showNodeDetails(found.id);
  searchInput.value = '';
});

// -------------------- Filter by node type buttons --------------------
document.querySelectorAll('.filterBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    if (!visNodes || !visEdges) return;
    visNodes.forEach(n => visNodes.update({ id: n.id, hidden: true }));
    visEdges.forEach(e => visEdges.update({ id: e.id, hidden: true }));
    visNodes.forEach(n => {
      if (n.group === type) {
        visNodes.update({ id: n.id, hidden: false });
        const con = visEdges.get({ filter: e => e.from === n.id || e.to === n.id });
        con.forEach(edge => {
          visEdges.update({ id: edge.id, hidden: false });
          const neighbor = edge.from === n.id ? edge.to : edge.from;
          visNodes.update({ id: neighbor, hidden: false });
        });
      }
    });
    network.fit();
  });
});

document.getElementById('resetNodeFilter')?.addEventListener('click', () => {
  visNodes.forEach(n => visNodes.update({ id: n.id, hidden: false }));
  visEdges.forEach(e => visEdges.update({ id: e.id, hidden: false }));
  network.fit();
});

// -------------------- Buttons wiring --------------------
btnAutoCluster?.addEventListener('click', cleanLayout);

// CSV import
btnImportCsv?.addEventListener('click', async () => {
  const file = csvFileInput.files[0];
  if (!file) return alert("Choose CSV file first");
  const text = await file.text();
  try {
    const res = await fetch("http://localhost:3000/importPatientsCsv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: text })
    });
    const j = await res.json();
    alert(j.message || "Imported");
    await new Promise(r => setTimeout(r, 300));
    render();
  } catch (e) {
    alert("Failed to import CSV");
    console.error(e);
  }
});

// Calculate Risk
btnRisk?.addEventListener('click', async () => {
  try {
    const res = await fetch("http://localhost:3000/calculateRisk", { method: "POST" });
    const j = await res.json();
    alert(j.message || "Risk scores updated!");
    await new Promise(r => setTimeout(r, 300));
    render();
  } catch (e) {
    console.error("Risk error:", e);
    alert("Failed to calculate risk");
  }
});

// Similarity (improved flow: select patient node first)
btnSimilarity?.addEventListener('click', async () => {
  if (!network) return alert("Graph not loaded yet");
  const sel = network.getSelectedNodes();
  if (!sel.length) return alert("Select a patient node first, then click Find Similar Patients.");
  const selId = sel[0];
  const selNode = visNodes.get(selId);
  if (!selNode || selNode.group !== "Patient") return alert("Please click on a PATIENT node first.");

  try {
    setStatus("Calculating similarity...");
    const res = await fetch("http://localhost:3000/calculateSimilarity", { method: "POST" });
    const msg = await res.json();
    alert(msg.message || "Similar patients linked!");
    await new Promise(r => setTimeout(r, 350));
    await render();

    // re-find selected patient (by patientId)
    const updated = visNodes.get().find(n => n.properties?.patientId?.toLowerCase() === selNode.properties.patientId.toLowerCase());
    if (!updated) { setStatus(""); return alert("Could not re-find selected patient after refresh."); }
    const newId = updated.id;

    const simEdges = visEdges.get({ filter: e => (String(e.label).toUpperCase() === "SIMILAR_TO" || String(e.label).toUpperCase().includes("SIMILAR")) && (e.from === newId || e.to === newId) });
    if (!simEdges.length) {
      setStatus("");
      showNodeDetails(newId);
      return alert("No similar patients found for this patient.");
    }

    simEdges.forEach(e => {
      visEdges.update({ id: e.id, color: { color: "#ff0000", highlight: "#ff0000" }, width: 4 });
      visNodes.update({ id: e.from, size: 40 });
      visNodes.update({ id: e.to, size: 40 });
    });

    network.selectNodes([newId]);
    network.focus(newId, { scale: 1.3, animation: { duration: 400 }});
    showNodeDetails(newId);
    setStatus("");
  } catch (e) {
    console.error("Similarity error:", e);
    alert("Failed to calculate similarity");
  }
});

// Reset / Refresh
btnReset?.addEventListener('click', resetLayout);
btnRefresh?.addEventListener('click', () => render());

// -------------------- Relationship filter (connected to <select id="filterRelType">) --------------------
relFilter?.addEventListener("change", () => {
  const selected = relFilter.value;
  if (!visNodes || !visEdges) return;

  if (selected === "") {
    visNodes.forEach(n => visNodes.update({ id: n.id, hidden: false }));
    visEdges.forEach(e => visEdges.update({ id: e.id, hidden: false }));
    network.fit();
    return;
  }

  // Hide everything then show only edges of that type and their nodes
  visNodes.forEach(n => visNodes.update({ id: n.id, hidden: true }));
  visEdges.forEach(e => visEdges.update({ id: e.id, hidden: true }));

  const allowedEdges = visEdges.get({ filter: e => String(e.label).toUpperCase() === selected.toUpperCase() });
  allowedEdges.forEach(edge => {
    visEdges.update({ id: edge.id, hidden: false });
    visNodes.update({ id: edge.from, hidden: false });
    visNodes.update({ id: edge.to, hidden: false });
  });

  network.fit();
});

// Initial load
render();
