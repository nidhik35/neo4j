require('dotenv').config();
const express = require('express');
const neo4j = require('neo4j-driver');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Neo4j connection
const driver = neo4j.driver(
  'bolt://127.0.0.1:7687',
  neo4j.auth.basic('neo4j', 'neo4j123'),
  { encrypted: 'ENCRYPTION_OFF' }
);

const DB_NAME = 'medgraph';

app.get('/', (req, res) => res.send('Neo4j Medical Graph backend running'));


// -------------------------------------------------------------
// 1️⃣  CREATE NODES
// -------------------------------------------------------------

app.post('/addDrug', async (req, res) => {
  const { name } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    const result = await session.run(
      'CREATE (d:Drug {name: $name}) RETURN d',
      { name }
    );
    res.json(result.records[0].get('d').properties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    session.close();
  }
});

app.post('/addDisease', async (req, res) => {
  const { name } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    const result = await session.run(
      'CREATE (d:Disease {name: $name}) RETURN d',
      { name }
    );
    res.json(result.records[0].get('d').properties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    session.close();
  }
});

app.post('/addGene', async (req, res) => {
  const { name } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    const result = await session.run(
      'CREATE (g:Gene {name: $name}) RETURN g',
      { name }
    );
    res.json(result.records[0].get('g').properties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    session.close();
  }
});


// -------------------------------------------------------------
// 2️⃣  CREATE RELATIONSHIPS
// -------------------------------------------------------------

app.post('/linkDrugDisease', async (req, res) => {
  const { drugName, diseaseName } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    await session.run(
      `
      MATCH (d:Drug {name: $drugName}), (ds:Disease {name: $diseaseName})
      CREATE (d)-[:TREATS]->(ds)
      `,
      { drugName, diseaseName }
    );

    res.json({ message: 'TREATS relationship created!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    session.close();
  }
});


app.post('/linkDrugGene', async (req, res) => {
  const { drugName, geneName } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    await session.run(
      `
      MATCH (d:Drug {name: $drugName}), (g:Gene {name: $geneName})
      CREATE (d)-[:AFFECTS]->(g)
      `,
      { drugName, geneName }
    );

    res.json({ message: 'AFFECTS relationship created!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    session.close();
  }
});


// -------------------------------------------------------------
// 3️⃣  SAFE DELETE — RELATIONSHIPS
// -------------------------------------------------------------

app.delete('/unlinkDrugDisease', async (req, res) => {
  const { drugName, diseaseName } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    await session.run(
      `
      MATCH (d:Drug {name: $drugName})-[r:TREATS]->(ds:Disease {name: $diseaseName})
      DELETE r
      `,
      { drugName, diseaseName }
    );

    res.json({ message: 'TREATS relationship removed!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    session.close();
  }
});


app.delete('/unlinkDrugGene', async (req, res) => {
  const { drugName, geneName } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    await session.run(
      `
      MATCH (d:Drug {name: $drugName})-[r:AFFECTS]->(g:Gene {name: $geneName})
      DELETE r
      `,
      { drugName, geneName }
    );

    res.json({ message: 'AFFECTS relationship removed!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    session.close();
  }
});


// -------------------------------------------------------------
// 4️⃣  SAFE DELETE NODE
// -------------------------------------------------------------

app.delete('/deleteNode', async (req, res) => {
  const { name } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    await session.run(
      `
      MATCH (n {name: $name})
      DETACH DELETE n
      `,
      { name }
    );

    res.json({ message: `Node '${name}' deleted successfully!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    session.close();
  }
});


// -------------------------------------------------------------
// 5️⃣  GET FULL GRAPH — FIXED
// -------------------------------------------------------------

app.get('/getFullGraph', async (req, res) => {
  const session = driver.session({ database: DB_NAME });

  try {
    const nodesResult = await session.run(`MATCH (n) RETURN n`);
    const nodes = nodesResult.records.map(r => ({
      labels: r.get('n').labels,
      properties: r.get('n').properties
    }));

    const relsResult = await session.run(`
      MATCH (a)-[r]->(b)
      RETURN a, r, b
    `);

    const relationships = relsResult.records.map(rec => ({
      start: rec.get("a").properties,
      type: rec.get("r").type,
      properties: rec.get("r").properties || {},
      end: rec.get("b").properties
    }));

    res.json({ nodes, relationships });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });

  } finally {
    await session.close();
  }
});


// -------------------------------------------------------------
// 6️⃣  ADD PATIENT (FIXED VERSION)
// -------------------------------------------------------------
app.post("/addPatient", async (req, res) => {
  const { patientId, age, sex, notes } = req.body;

  try {
    // 1️⃣ Check if patient already exists
    const check = await session.run(
      "MATCH (p:Patient {patientId: $patientId}) RETURN p",
      { patientId }
    );

    if (check.records.length > 0) {
      return res.json({ success: false, message: "Patient already exists" });
    }

    // 2️⃣ Create new patient
    await session.run(
      `CREATE (p:Patient {
        patientId: $patientId,
        age: toInteger($age),
        sex: $sex,
        notes: $notes
      })`,
      { patientId, age, sex, notes }
    );

    res.json({ success: true, message: "Patient added successfully" });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Error adding patient" });
  }
});

// -------------------------------------------------------------
// 7️⃣  LINK PATIENT → DISEASE
// -------------------------------------------------------------

app.post('/linkPatientDisease', async (req, res) => {
  const { patientId, diseaseName } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    await session.run(
      `
      MATCH (p:Patient {patientId: $patientId}), (d:Disease {name: $diseaseName})
      MERGE (p)-[:HAS_DISEASE]->(d)
      `,
      { patientId, diseaseName }
    );

    res.json({ message: 'Linked patient → disease' });

  } catch (err) {
    res.status(500).json({ error: err.message });

  } finally {
    session.close();
  }
});


// -------------------------------------------------------------
// 8️⃣  IMPORT CSV
// -------------------------------------------------------------

app.post("/importPatientsCsv", async (req, res) => {
  const { csv } = req.body;
  const session = driver.session({ database: DB_NAME });

  try {
    const lines = csv.split("\n").filter(l => l.trim());
    const tx = session.beginTransaction();

    for (const line of lines) {
      const [patientId, age, sex, diseases, notes] = line.split(",");

      await tx.run(
        `
        MERGE (p:Patient {patientId:$patientId})
        SET p.age = toInteger($age),
            p.sex = $sex,
            p.notes = $notes
        `,
        { patientId, age, sex, notes }
      );

      if (diseases) {
        const list = diseases.split("|");
        for (const d of list) {
          await tx.run(
            `
            MATCH (p:Patient {patientId:$patientId}), (d:Disease {name:$d})
            MERGE (p)-[:HAS_DISEASE]->(d)
            `,
            { patientId, d }
          );
        }
      }
    }

    await tx.commit();
    res.json({ message: "CSV Imported" });

  } catch (error) {
    res.status(500).json({ error: error.message });

  } finally {
    session.close();
  }
});


// -------------------------------------------------------------
// 9️⃣  CALCULATE RISK SCORE
// -------------------------------------------------------------

app.post("/calculateRisk", async (req, res) => {
  const session = driver.session({ database: DB_NAME });

  try {
    await session.run(`
      MATCH (p:Patient)
      OPTIONAL MATCH (p)-[:HAS_DISEASE]->(d:Disease)
      OPTIONAL MATCH (p)-[:HAS_SYMPTOM]->(s:Symptom)
      OPTIONAL MATCH (p)-[:HAS_GENE]->(g:Gene)

      WITH p,
           size(collect(DISTINCT d)) AS diseaseCount,
           size(collect(DISTINCT s)) AS symptomCount,
           size(collect(DISTINCT g)) AS geneCount,
           p.age AS age

      WITH p,
           (diseaseCount * 4) +
           (symptomCount * 2) +
           (geneCount * 5) +
           (CASE WHEN age > 60 THEN 10 ELSE 0 END) AS riskScore

      SET p.riskScore = riskScore
    `);

    res.json({ message: "Risk scores updated!" });

  } catch (err) {
    res.status(500).json({ error: err.message });

  } finally {
    session.close();
  }
});


// -------------------------------------------------------------
// 🔟  FIND SIMILAR PATIENTS
// -------------------------------------------------------------

// Replace your existing /calculateSimilarity endpoint with this:
app.post("/calculateSimilarity", async (req, res) => {
  const session = driver.session({ database: DB_NAME });

  try {
    // Create SIMILAR_TO relationships for all qualifying pairs
    const result = await session.run(`
      MATCH (p1:Patient)-[:HAS_DISEASE]->(d:Disease)<-[:HAS_DISEASE]-(p2:Patient)
      WHERE p1.patientId < p2.patientId
      WITH p1, p2, COUNT(DISTINCT d) AS sharedDiseases

      OPTIONAL MATCH (p1)-[:HAS_SYMPTOM]->(s:Symptom)<-[:HAS_SYMPTOM]-(p2)
      WITH p1, p2, sharedDiseases, COUNT(DISTINCT s) AS sharedSymptoms

      WITH p1, p2, sharedDiseases, sharedSymptoms,
           (sharedDiseases * 3) +
           (sharedSymptoms * 2) +
           (CASE WHEN sharedDiseases > 0 THEN 2 ELSE 0 END) AS simScore

      WHERE simScore > 1

      MERGE (p1)-[r:SIMILAR_TO]->(p2)
      SET r.score = simScore
      RETURN count(r) AS createdCount
    `);

    const createdCount = result.records?.[0]?.get("createdCount")?.toNumber?.() ?? result.records?.[0]?.get("createdCount") ?? 0;
    res.json({ message: "Similar patients linked!", created: createdCount });
  } catch (err) {
    console.error("SIMILARITY ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});


app.listen(3000, () => console.log('Server running on port 3000'));
