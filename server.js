const express = require("express");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const mammoth = require("mammoth");

const app = express();
const PORT = 3000;

/* -------- Directories -------- */
const ALLEN_DIR = path.join(__dirname, "allenhandbook");
const HERING_DIR = path.join(__dirname, "hering");
const KENT_FILE = path.join(__dirname, "isilo_kent.docx");   // <-- Add Kent text file
const BOERICKE_FILE = path.join(__dirname, "isilo_boericke.docx");

let BOERICKE_CACHE = null;
let KENT_CACHE = null;

app.use(express.static("public"));
app.use(express.json());

/* ---------------- UTILITIES ---------------- */

function clean(text) {
    return text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function stripHTML(html) {
    return html.replace(/<[^>]+>/g, "");
}

/* ---------- SEARCH MATCHING (UNIFIED) ---------- */

function matchAND(text, words) {
    text = text.toLowerCase();
    return words.every(w => text.includes(w));  // substring match
}

function matchOR(text, words) {
    text = text.toLowerCase();
    return words.some(w => text.includes(w));  // substring match
}

function matchPHRASE(text, phrase) {
    return text.toLowerCase().includes(phrase.toLowerCase());
}

function sectionMatches(text, mode, words, phrase) {
    if (mode === "AND") return matchAND(text, words);
    if (mode === "OR") return matchOR(text, words);
    if (mode === "PHRASE") return matchPHRASE(text, phrase);
    return false;
}

/* ================== ALLEN PARSER ================== */

function parseAllen(html, words, phrase, mode, grouped, seen) {
    const dom = new JSDOM(html, { runScripts: "outside-only" });
    const document = dom.window.document;

    // Find remedy name
    let remedy = "Unknown Medicine";
    const centers = [...document.querySelectorAll("p[align='CENTER']")];
    let bookFound = false;

    for (const p of centers) {
        const t = clean(p.textContent);
        if (t.toLowerCase().includes("hand book of materia medica")) {
            bookFound = true;
            continue;
        }
        if (bookFound && t.endsWith(".") && t.length < 50) {
            remedy = t;
            break;
        }
    }

    // Parse sections
    const paragraphs = [...document.querySelectorAll("p")];
    let current = null;

    for (const p of paragraphs) {
        const text = clean(p.textContent);
        const header = text.match(/^([A-Za-z\s]+)\s*:-/);

        if (header) {
            pushAllenSection(current, words, phrase, mode, remedy, grouped, seen);
            current = { heading: header[1].trim(), content: text };
        } else if (current) {
            current.content += " " + text;
        }
    }

    pushAllenSection(current, words, phrase, mode, remedy, grouped, seen);
    dom.window.close();
}

function pushAllenSection(section, words, phrase, mode, remedy, grouped, seen) {
    if (!section) return;

    if (!sectionMatches(section.content, mode, words, phrase)) return;

    const key = `allen||${remedy}||${section.heading}`;
    if (seen.has(key)) return;
    seen.add(key);

    if (!grouped[remedy]) grouped[remedy] = [];

    grouped[remedy].push({
        section: section.heading,
        text: section.content
    });
}

/* ================== HERING PARSER ================== */

function parseHering(filePath, words, phrase, mode, grouped, seen) {
    const html = fs.readFileSync(filePath, "utf8");
    const rawText = stripHTML(html);

    let remedy = "Unknown Medicine";
    const titleMatch = html.match(/<title>([^.]+)\./i);
    if (titleMatch) remedy = titleMatch[1].trim() + ".";

    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let current = null;

    for (const line of lines) {
        const header = line.match(/^([A-Z ,]+)\.\s*\[\d+\]/);

        if (header) {
            pushHeringSection(current, words, phrase, mode, remedy, grouped, seen);
            current = { heading: header[1].trim(), content: line };
        } else if (current) {
            current.content += " " + line;
        }
    }

    pushHeringSection(current, words, phrase, mode, remedy, grouped, seen);
}

function pushHeringSection(section, words, phrase, mode, remedy, grouped, seen) {
    if (!section) return;

    if (!sectionMatches(section.content, mode, words, phrase)) return;

    const key = `hering||${remedy}||${section.heading}`;
    if (seen.has(key)) return;

    seen.add(key);
    if (!grouped[remedy]) grouped[remedy] = [];

    grouped[remedy].push({
        section: section.heading,
        text: section.content
    });
}

/* ================== BOERICKE PARSER ================== */

async function loadBoericke() {
    if (BOERICKE_CACHE) return BOERICKE_CACHE;

    console.log("Loading Boericke DOCX...");
    const result = await mammoth.extractRawText({ path: BOERICKE_FILE });
    const lines = result.value.split("\n").map(l => l.trim());

    let remedies = {};
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

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

function parseBoericke(words, phrase, mode, grouped, seen) {
    if (!BOERICKE_CACHE) return;

    for (const remedy in BOERICKE_CACHE) {
        for (const entry of BOERICKE_CACHE[remedy]) {
            if (!sectionMatches(entry.text, mode, words, phrase)) continue;

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

/* ================== KENT PARSER ================== */

async function loadKent() {
    if (KENT_CACHE) return KENT_CACHE;

    console.log("Loading Kent DOCX…");

    // Extract **plain text** from DOCX
    const result = await mammoth.extractRawText({ path: KENT_FILE });
    const lines = result.value
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);

    let remedies = {};
    let currentRemedy = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^[A-Z][A-Za-z\s]+$/.test(line) && line.length > 5) {
            currentRemedy = line.trim();
            remedies[currentRemedy] = [];
            continue;
        }

        if (!currentRemedy) continue;

        // Kent has long blocks → treat each paragraph as a "section"
        remedies[currentRemedy].push({
            section: "Lecture",
            text: line
        });
    }

    KENT_CACHE = remedies;
    console.log("Kent DOCX Loaded.");
    return remedies;
}

function parseKent(words, phrase, mode, grouped, seen) {
    if (!KENT_CACHE) return;

    for (const remedy in KENT_CACHE) {
        for (const entry of KENT_CACHE[remedy]) {
            if (!sectionMatches(entry.text, mode, words, phrase)) continue;

            const key = `kent||${remedy}||lecture`;
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

/* ================== SEARCH API ================== */

app.post("/search", async (req, res) => {
    const { word, book, mode } = req.body;

    if (!word || !book) return res.json({});

    const searchWords = word.toLowerCase().split(/\s+/).filter(Boolean);
    const phrase = word.trim();

    const groupedResults = {};
    const seen = new Set();

    if (book === "allen") {
        const files = fs.readdirSync(ALLEN_DIR).filter(f => f.endsWith(".htm"));
        for (const f of files) {
            const html = fs.readFileSync(path.join(ALLEN_DIR, f), "utf8");
            parseAllen(html, searchWords, phrase, mode, groupedResults, seen);
        }
    }

    else if (book === "hering") {
        const files = fs.readdirSync(HERING_DIR).filter(f => f.endsWith(".htm"));
        for (const f of files) {
            parseHering(path.join(HERING_DIR, f), searchWords, phrase, mode, groupedResults, seen);
        }
    }

    else if (book === "boericke") {
        await loadBoericke();
        parseBoericke(searchWords, phrase, mode, groupedResults, seen);
    }

    else if (book === "kent") {
        await loadKent();
        parseKent(searchWords, phrase, mode, groupedResults, seen);
    }

    res.json(groupedResults);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
