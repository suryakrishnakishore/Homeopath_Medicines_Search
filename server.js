const express = require("express");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const mammoth = require("mammoth");

const app = express();
const PORT = 3000;

const ALLEN_DIR = path.join(__dirname, "allenhandbook");
const HERING_DIR = path.join(__dirname, "hering");
const BOERICKE_FILE = path.join(__dirname, "isilo_boericke.docx");
const KENT_FILE = path.join(__dirname, "isilo_kent.docx");

let BOERICKE_CACHE = null;
let KENT_CACHE = null;

app.use(express.static("public"));
app.use(express.json());

/* ---------------- UTIL ---------------- */

function clean(text) {
    return text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function stripHTML(html) {
    return html.replace(/<[^>]+>/g, "");
}

/* ================= ALLEN ================= */

function parseAllen(html, searchWord, book, grouped, seen) {
    const dom = new JSDOM(html, {
        runScripts: "outside-only",
        pretendToBeVisual: false
    });

    const document = dom.window.document;

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

    if (!grouped[remedy]) grouped[remedy] = [];

    grouped[remedy].push({
        section: section.heading,
        text: section.content
    });
}

/* ================= HERING ================= */

function parseHering(filePath, searchWord, book, grouped, seen) {
    const html = fs.readFileSync(filePath, "utf8");

    let remedy = "Unknown Medicine";
    const titleMatch = html.match(/<title>([^.]+)\./i);
    if (titleMatch) remedy = titleMatch[1].trim() + ".";

    const rawText = stripHTML(html);
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

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

    if (!grouped[remedy]) grouped[remedy] = [];

    grouped[remedy].push({
        section: section.heading,
        text: section.content
    });
}

/* ================= BOERICKE ================= */

async function loadBoericke() {
    if (BOERICKE_CACHE) return BOERICKE_CACHE;

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
            i++;
            continue;
        }

        if (!current || !line) continue;

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
    return remedies;
}

function parseBoericke(searchWord, grouped, seen) {
    if (!BOERICKE_CACHE) return;

    for (const remedy in BOERICKE_CACHE) {
        for (const entry of BOERICKE_CACHE[remedy]) {
            if (!entry.text.toLowerCase().includes(searchWord)) continue;

            const key = `boericke||${remedy}||${entry.section}`;
            if (seen.has(key)) continue;
            seen.add(key);

            if (!grouped[remedy]) grouped[remedy] = [];

            grouped[remedy].push({
                section: entry.section,
                text: entry.text
            });
        }
    }
}

/* ================= KENT DOCX PARSER ================= */

async function loadKent() {
    if (KENT_CACHE) return KENT_CACHE;

    console.log("Loading Kent DOCX...");

    const result = await mammoth.extractRawText({ path: KENT_FILE });
    const lines = result.value
        .split(/\r?\n/)
        .map(l => l.trim());

    let remedies = {};
    let currentRemedy = null;
    let currentSection = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!line) continue;

        /* ----- Remedy Detection ----- */
        if (/^[A-Z][a-z]+(?: [A-Z][a-z]+){0,3}$/.test(line)) {
            currentRemedy = line.trim();
            remedies[currentRemedy] = [];
            currentSection = null;
            continue;
        }

        if (!currentRemedy) continue;

        /* ----- Subheading Detection ----- */
        const subMatch = line.match(/^([A-Za-z][A-Za-z ]+):\s*(.*)$/);

        if (subMatch) {
            const heading = subMatch[1].trim();
            const firstText = subMatch[2].trim();

            remedies[currentRemedy].push({
                section: heading,
                text: firstText
            });

            currentSection = remedies[currentRemedy].length - 1;
            continue;
        }

        /* ----- Content Continuation ----- */
        if (currentSection !== null) {
            remedies[currentRemedy][currentSection].text += " " + line;
        }
    }

    KENT_CACHE = remedies;
    console.log("Kent Loaded.");

    return remedies;
}

function parseKent(searchWord, grouped, seen) {
    if (!KENT_CACHE) return;

    for (const remedy in KENT_CACHE) {
        for (const entry of KENT_CACHE[remedy]) {

            if (!entry.text.toLowerCase().includes(searchWord)) continue;

            const key = `kent||${remedy}||${entry.section}`;
            if (seen.has(key)) continue;
            seen.add(key);

            if (!grouped[remedy]) grouped[remedy] = [];

            grouped[remedy].push({
                section: entry.section,
                text: entry.text
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

    else if (book === "kent") {
        await loadKent();
        parseKent(searchWord, groupedResults, seen);
    }

    res.json(groupedResults);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
