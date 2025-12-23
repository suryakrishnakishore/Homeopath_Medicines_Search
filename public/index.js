const searchInput = document.getElementById("searchInput");
const bookSelect = document.getElementById("bookSelect");
const modeSelect = document.getElementById("modeSelect");
const searchBtn = document.getElementById("searchBtn");
const resultsDiv = document.getElementById("results");

/* ---------- Highlight ---------- */
function highlight(text, search, mode) {
    if (mode === "PHRASE") {
        // highlight exact phrase only
        const escPhrase = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const phraseRegex = new RegExp(`(${escPhrase})`, "gi");
        return text.replace(phraseRegex, `<span class="highlight">$1</span>`);
    }

    // AND/OR → highlight each word separately
    const words = search.split(/\s+/).filter(Boolean);

    let result = text;

    words.forEach(word => {
        const escWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordRegex = new RegExp(`(${escWord})`, "gi");
        result = result.replace(wordRegex, `<span class="highlight">$1</span>`);
    });

    return result;
}


/* ---------- Search ---------- */
searchBtn.addEventListener("click", async () => {
    const word = searchInput.value.trim();
    const book = bookSelect.value;
    const mode = modeSelect.value;

    if (!word) {
        alert("Please enter a search term.");
        return;
    }

    searchBtn.disabled = true;
    searchBtn.textContent = "Searching…";
    resultsDiv.innerHTML = "";

    try {
        const res = await fetch("/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word, book, mode })
        });

        const data = await res.json();

        if (!Object.keys(data).length) {
            resultsDiv.innerHTML = `<div class="no-results">No matches found.</div>`;
            return;
        }

        for (const remedy in data) {
            const remedyCard = document.createElement("div");
            remedyCard.className = "remedy-card";

            const title = document.createElement("div");
            title.className = "remedy-title";
            title.textContent = remedy;

            const grid = document.createElement("div");
            grid.className = "section-grid";

            data[remedy].forEach(section => {
                const card = document.createElement("div");
                card.className = "section-card";

                card.innerHTML = `
                    <div class="section-title">${section.section}</div>
                    <div class="section-text">
                        ${highlight(section.text, word, mode)}
                    </div>
                `;

                grid.appendChild(card);
            });

            remedyCard.appendChild(title);
            remedyCard.appendChild(grid);
            resultsDiv.appendChild(remedyCard);
        }

    } catch (error) {
        resultsDiv.innerHTML = `<div class="no-results">Error while searching.</div>`;
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = "Search";
    }
});
