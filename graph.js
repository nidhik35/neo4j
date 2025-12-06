const express = require("express");
const router = express.Router();

const Drug = require("../models/Drug");
const Disease = require("../models/Disease");
const Relation = require("../models/Relation");

router.get("/", async (req, res) => {
    const drugs = await Drug.find();
    const diseases = await Disease.find();
    const relations = await Relation.find();

    const nodes = [];
    const edges = [];

    drugs.forEach(d => nodes.push({ id: d._id, label: d.name, group: "drug" }));
    diseases.forEach(ds => nodes.push({ id: ds._id, label: ds.name, group: "disease" }));

    relations.forEach(r => edges.push({ from: r.drug, to: r.disease }));

    res.json({ nodes, edges });
});

module.exports = router;
