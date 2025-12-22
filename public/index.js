const searchInput = document.getElementById("searchInput");
const bookSelect = document.getElementById("bookSelect");
const searchBtn = document.getElementById("searchBtn");
const resultsDiv = document.getElementById("results");

/* ---------- Highlight ---------- */
function highlight(text, word) {
    const regex = new RegExp(`(${word})`, "gi");
    return text.replace(regex, `<span class="highlight">$1</span>`);
}

/* ---------- Search ---------- */
searchBtn.addEventListener("click", async () => {
    const word = searchInput.value.trim();
    const book = bookSelect.value;

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
            body: JSON.stringify({ word, book })
        });

        const data = await res.json();

        if (!Object.keys(data).length) {
            resultsDiv.innerHTML =
                `<div class="no-results">No matches found.</div>`;
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
                        ${highlight(section.text, word)}
                    </div>
                `;

                grid.appendChild(card);
            });

            remedyCard.appendChild(title);
            remedyCard.appendChild(grid);
            resultsDiv.appendChild(remedyCard);
        }

    } catch (error) {
        resultsDiv.innerHTML =
            `<div class="no-results">Error while searching.</div>`;
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = "Search";
    }
});
