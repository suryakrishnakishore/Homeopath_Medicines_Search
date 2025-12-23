const express = require("express");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const mammoth = require("mammoth");   // << ADDED

const app = express();
const PORT = 3000;

const ALLEN_DIR = path.join(__dirname, "allenhandbook");
const HERING_DIR = path.join(__dirname, "hering");
const BOERICKE_FILE = path.join(__dirname, "isilo_boericke.docx");  // << ADDED

let BOERICKE_CACHE = null;  // << ADDED

app.use(express.static("public"));
app.use(express.json());

/* ---------------- UTIL ---------------- */

function clean(text) {
    return text
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function stripHTML(html) {
    return html.replace(/<[^>]+>/g, "");
}

/* ================= ALLEN PARSER ================= */

function parseAllen(html, searchWord, book, grouped, seen) {
    const dom = new JSDOM(html, {
        runScripts: "outside-only",
        pretendToBeVisual: false
    });

    const document = dom.window.document;

    /* --- Remedy name --- */
    let remedy = "Unknown Medicine";
    const centers = [...document.querySelectorAll("p[align='CENTER']")];
    let bookFound = false;

    for (const p of centers) {
        const t = clean(p.textContent);
        if (t.toLowerCase().includes("hand book of materia medica")) {
            bookFound = true;
            continue;
        }
        if (bookFound && t.endsWith(".") && t.length < 30) {
            remedy = t;
            break;
        }
    }

    /* --- Sections --- */
    const paragraphs = [...document.querySelectorAll("p")];
    let current = null;

    for (const p of paragraphs) {
        const text = clean(p.textContent);
        const header = text.match(/^([A-Za-z\s]+)\s*:-/);

        if (header) {
            pushAllenSection(current, searchWord, book, remedy, grouped, seen);
            current = { heading: header[1].trim(), content: text };
        } else if (current) {
            current.content += " " + text;
        }
    }

    pushAllenSection(current, searchWord, book, remedy, grouped, seen);
    dom.window.close();
}

function pushAllenSection(section, searchWord, book, remedy, grouped, seen) {
    if (!section) return;

    if (!section.content.toLowerCase().includes(searchWord)) return;

    const key = `${book}||${remedy}||${section.heading}`;
    if (seen.has(key)) return;
    seen.add(key);

    if (!grouped[remedy]) {
        grouped[remedy] = [];
    }

    grouped[remedy].push({
        section: section.heading,
        text: section.content
    });
}

/* ================= HERING PARSER ================= */

function parseHering(filePath, searchWord, book, grouped, seen) {
    const html = fs.readFileSync(filePath, "utf8");

    /* --- Remedy name from <title> --- */
    let remedy = "Unknown Medicine";
    const titleMatch = html.match(/<title>([^.]+)\./i);
    if (titleMatch) {
        remedy = titleMatch[1].trim() + ".";
    }

    const rawText = stripHTML(html);
    const lines = rawText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

    let current = null;

    for (const line of lines) {
        const header = line.match(/^([A-Z ,]+)\.\s*\[\d+\]/);

        if (header) {
            pushHeringSection(current, searchWord, book, remedy, grouped, seen);
            current = { heading: header[1].trim(), content: line };
        } else if (current) {
            current.content += " " + line;
        }
    }

    pushHeringSection(current, searchWord, book, remedy, grouped, seen);
}

function pushHeringSection(section, searchWord, book, remedy, grouped, seen) {
    if (!section) return;

    if (!section.content.toLowerCase().includes(searchWord)) return;

    const key = `${book}||${remedy}||${section.heading}`;
    if (seen.has(key)) return;
    seen.add(key);

    if (!grouped[remedy]) {
        grouped[remedy] = [];
    }

    grouped[remedy].push({
        section: section.heading,
        text: section.content
    });
}

/* ================= BOERICKE DOCX PARSER ================= */

async function loadBoericke() {
    if (BOERICKE_CACHE) return BOERICKE_CACHE;

    console.log("Loading Boericke DOCX...");

    const result = await mammoth.extractRawText({ path: BOERICKE_FILE });
    const lines = result.value.split("\n").map(l => l.trim());

    let remedies = {};
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Remedy title: ALL CAPS
        if (/^[A-Z][A-Z\s]+$/.test(line) && line.length > 3) {
            current = line.trim();
            remedies[current] = [];
            i++; // skip common name line
            continue;
        }

        if (!current || !line) continue;

        // Subheading e.g. Mind.--, Head.-- etc
        const match = line.match(/^([A-Za-z]+)\.\-\-\s*(.*)$/);

        if (match) {
            remedies[current].push({
                section: match[1].trim(),
                text: match[2].trim()
            });
        } else {
            remedies[current].push({
                section: "General",
                text: line
            });
        }
    }

    BOERICKE_CACHE = remedies;
    console.log("Boericke Loaded.");
    return remedies;
}

function parseBoericke(searchWord, grouped, seen) {
    if (!BOERICKE_CACHE) return;

    for (const remedy in BOERICKE_CACHE) {
        const entries = BOERICKE_CACHE[remedy];

        for (const e of entries) {
            if (!e.text.toLowerCase().includes(searchWord)) continue;

            const key = `boericke||${remedy}||${e.section}`;
            if (seen.has(key)) continue;
            seen.add(key);

            if (!grouped[remedy]) grouped[remedy] = [];

            grouped[remedy].push({
                section: e.section,
                text: e.text
            });
        }
    }
}

/* ================= API ================= */

app.post("/search", async (req, res) => {
    const { word, book } = req.body;
    if (!word || !book) return res.json({});

    const searchWord = word.toLowerCase();
    const groupedResults = {};
    const seen = new Set();

    if (book === "allen") {
        const files = fs.readdirSync(ALLEN_DIR).filter(f => f.endsWith(".htm"));
        for (const f of files) {
            const html = fs.readFileSync(path.join(ALLEN_DIR, f), "utf8");
            parseAllen(html, searchWord, book, groupedResults, seen);
        }
    }

    else if (book === "hering") {
        const files = fs.readdirSync(HERING_DIR).filter(f => f.endsWith(".htm"));
        for (const f of files) {
            parseHering(path.join(HERING_DIR, f), searchWord, book, groupedResults, seen);
        }
    }

    else if (book === "boericke") {
        await loadBoericke();
        parseBoericke(searchWord, groupedResults, seen);
    }

    res.json(groupedResults);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
