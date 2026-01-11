function getActiveTabText() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                console.info("Content script not available on this page.");
                return resolve({ text: "" });
            }
            if (!tabs || !tabs[0]) return resolve({ text: "" });
            chrome.tabs.sendMessage(tabs[0].id, { action: "getPageText" }, (response) => {
                if (chrome.runtime.lastError) {
                    return resolve({ text: "" });
                }
                resolve(response || { text: "" });
            });
        });
    });
}


function loadHistory() {
    chrome.storage.local.get("letterHistory", (data) => {
        const history = data.letterHistory || [];
        const historyList = document.getElementById("historyList");

        if (history.length === 0) {
            historyList.innerHTML = '<p style="color: #999;">No history yet...</p>';
            return;
        }

        historyList.innerHTML = history.reverse().map(item => `
            <div class="history-item">
                <div class="history-item-date">📅 ${item.date}</div>
                <div class="history-item-url">🔗 ${item.url}</div>
                <div style="font-size: 12px; color: #666; margin: 5px 0;">
                    ${item.isManual ? "📝 Manual" : "🤖 Generated"} | ID: ${item.id}
                </div>
                <div class="history-item-buttons">
                    ${item.letter ? `<button class="view-btn" data-id="${item.id}">View</button>` : ""}
                    <button class="delete-btn" data-id="${item.id}">Delete</button>
                </div>
            </div>
        `).join('');

        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'));
                viewHistoryLetter(id);
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'));
                deleteHistoryItem(id);
            });
        });
    });
}


function viewHistoryLetter(id) {
    chrome.storage.local.get("letterHistory", (data) => {
        const history = data.letterHistory || [];
        const item = history.find(h => h.id === id);
        
        if (item && item.letter) {
            document.getElementById("output").value = item.letter;
            // Switch to General tab
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="general"]').classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            document.getElementById("general").style.display = "block";
        }
    });
}

function deleteHistoryItem(id) {
    if (confirm("Delete this entry from history?")) {
        chrome.storage.local.get("letterHistory", (data) => {
            const history = data.letterHistory || [];
            const filtered = history.filter(h => h.id !== id);
            
            chrome.storage.local.set({ letterHistory: filtered }, () => {
                loadHistory();  // ✅ loadHistory() existe maintenant
                console.log("✅ Entry deleted from history");
            });
        });
    }
}

// ===== GEMINI FETCH (OUTSIDE DOMContentLoaded) =====
async function generateWithGemini(prompt) {
    // 💾 Récupérer de local (persistant)
    const storageData = await new Promise(resolve => chrome.storage.local.get("apiKey", resolve));
    const apiKey = storageData.apiKey;
    const errorMsg = document.getElementById("errorMsg");

    if (!apiKey) {
        throw new Error("⚠️ Please enter your API key in Settings.");
    }

    const payload = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        if (!navigator.onLine) {
            throw new Error("No internet connection. Please check your network.");
        }

        const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errorMessage = `API Error ${response.status}`;
            
            if (response.status === 401 || response.status === 403) {
                errorMessage = "❌ Invalid API key. Please check your settings.";
            } else if (response.status === 429) {
                errorMessage = "⏱️ Too many requests. Please wait a moment and try again.";
            } else if (response.status === 500 || response.status === 503) {
                errorMessage = "🔧 Gemini API is temporarily unavailable. Try again later.";
            } else {
                errorMessage = `❌ API returned error: ${response.status} ${response.statusText}`;
            }
            
            throw new Error(errorMessage);
        }

        const responseData = await response.json();

        if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("API returned no content. Try again.");
        }

        const letterContent = responseData.candidates[0]?.content?.parts?.[0]?.text;
        
        if (!letterContent || letterContent.trim() === "") {
            throw new Error("API returned an empty response. Try with a different job description.");
        }

        return letterContent;

    } catch (err) {
        clearTimeout(timeoutId);
        console.error("❌ Error generating letter:", err);
        throw err;
    }

    
}

    // ===== EXPORT CSV =====

// ===== EXPORT CSV (SANS INDENTATION) =====
function exportCsv() {
    chrome.storage.local.get("letterHistory", (data) => {
        const history = data.letterHistory || [];
        
        if (history.length === 0) {
            alert("⚠️ No history to export");
            return;
        }

        // ✅ Construire le CSV dans popup.js
        let csvContent = "Date,URL,Type,Has Letter\n";
        
        history.forEach(item => {
            const date = item.date ? `"${item.date}"` : '""';
            const url = item.url ? `"${item.url}"` : '""';
            const type = item.isManual ? '"Manual"' : '"Generated"';
            const hasLetter = item.letter ? '"Yes"' : '"No"';
            
            csvContent += `${date},${url},${type},${hasLetter}\n`;
        });

        // ✅ Envoyer au background.js pour télécharger
        chrome.runtime.sendMessage(
            { action: "downloadCsv", csvContent: csvContent },
            (response) => {
                console.log("✅ CSV exported: " + history.length + " entries");
            }
        );
    });
}




document.addEventListener('DOMContentLoaded', () => {
    
    // ===== TABS =====
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            contents.forEach(c => c.style.display = 'none');
            document.getElementById(tab.dataset.tab).style.display = 'block';
        });
    });

    // ===== LOAD DATA =====
    chrome.storage.local.get("userCV", (data) => {
        if(data.userCV) document.getElementById("cvInput").value = data.userCV;
    });

    chrome.storage.local.get("generatedLetter", (data) => {
        if (data.generatedLetter) {
            document.getElementById("output").value = data.generatedLetter;
        }
    });

    // ===== SAVE CV =====
    document.getElementById("saveCvBtn").addEventListener("click", () => {
        const cv = document.getElementById("cvInput").value;
        chrome.storage.local.set({ userCV: cv }, () => {
            const msg = document.getElementById("message");
            msg.textContent = "CV saved successfully!";
            setTimeout(() => msg.textContent = "", 2000);
        });
    });

    // ===== LOAD API KEY ON STARTUP =====
    chrome.storage.local.get("apiKey", (result) => {
        if (result.apiKey) {
            document.getElementById("apiKeyInput").placeholder = "••••••••••••••••• (Saved)";
        }
    });

    // ===== SAVE API KEY =====
    document.getElementById("saveApiKeyBtn").addEventListener("click", async () => {
        const apiKey = document.getElementById("apiKeyInput").value.trim();
        const msg = document.getElementById("message");
        const errorMsg = document.getElementById("errorMsg");
        
        if (!apiKey) {
            errorMsg.textContent = "❌ Please enter an API key";
            errorMsg.style.display = "block";
            setTimeout(() => errorMsg.style.display = "none", 3000);
            return;
        }
        
        try {
            await chrome.storage.local.set({ apiKey: apiKey });
            
            // ✅ Vider l'input après sauvegarde
            document.getElementById("apiKeyInput").value = "";
            document.getElementById("apiKeyInput").placeholder = "••••••••••••••••• (Saved)";
            
            msg.textContent = "✅ API Key saved!";
            msg.style.display = "block";
            errorMsg.style.display = "none";
            
            setTimeout(() => msg.textContent = "", 3000);
        } catch (err) {
            console.error("Error saving API key:", err);
            errorMsg.textContent = "❌ Error saving API key";
            errorMsg.style.display = "block";
        }
    });

    // ===== GENERATE LETTER =====
    let lastGenerateTime = 0;
    const GENERATE_COOLDOWN = 5000; // 5 secondes

    const generateBtn = document.getElementById("generateBtn");

    generateBtn.addEventListener("click", async () => {
        // ✅ Vérifier le cooldown
        const now = Date.now();
        if (now - lastGenerateTime < GENERATE_COOLDOWN) {
            const remaining = Math.ceil((GENERATE_COOLDOWN - (now - lastGenerateTime)) / 1000);
            const errorMsg = document.getElementById("errorMsg");
            errorMsg.textContent = `⏳ Please wait ${remaining}s before generating another letter.`;
            errorMsg.style.display = "block";
            return;
        }
        lastGenerateTime = now;

        const getCV = () => new Promise(resolve => chrome.storage.local.get("userCV", resolve));
        generateBtn.disabled = true;
        generateBtn.textContent = "⏳ Generating...";
        
        // ✅ DÉCLARER output ET errorMsg ICI (avant try/catch)
        const errorMsg = document.getElementById("errorMsg");
        const output = document.getElementById("output");
        
        try {
            const data = await getCV();
            const cv = data.userCV || "";

            if (!cv) {
                errorMsg.textContent = "⚠️ Please enter your CV first.";
                errorMsg.style.display = "block";
                return;
            } else {
                errorMsg.style.display = "none";
            }

            output.value = "⏳ Generating… please wait";

            const response = await getActiveTabText();
            const jobText = response?.text || "";
            const language = document.getElementById("languageSelect").value;

            const today = new Date();
            const day = String(today.getDate()).padStart(2, '0');
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const year = today.getFullYear();
            const currentDate = `${day}/${month}/${year}`;

            const languageMap = {
                fr: "French", en: "English", es: "Spanish", de: "German", it: "Italian",
                pt: "Portuguese", nl: "Dutch", sv: "Swedish", no: "Norwegian",
                da: "Danish", fi: "Finnish", pl: "Polish", ru: "Russian",
                ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic"
            };
            const langName = languageMap[language] || "English";

            const prompt = `
CV:
${cv}

Position:
${jobText}

Write a SHORT, ENGAGING LinkedIn message in ${langName} that I can send directly to a recruiter or hiring manager for this position.
- The message should be concise (150-200 words max) and professional yet personable.
- Highlight 2-3 key skills from my CV that match the job requirements.
- Show genuine interest in the role and company.
- Include a clear call-to-action (e.g., "I'd love to discuss how I can contribute to your team").
- Use natural, conversational language suitable for LinkedIn (not formal like a cover letter).
- Do NOT use markdown, brackets, or placeholders - write as if ready to paste directly into LinkedIn.
- Do NOT mention that the message was generated by AI.
- Do NOT use generic phrases like "[Company Name]" - use specific details if available from the job description.
- Keep it human, authentic, and compelling.
- The message must be in ${langName}.
- Do NOT include a subject line or "Dear [Name]" - just write the message body.

Write only the message, nothing else.
`;
/** 
Write a complete, professional cover letter in ${langName} that is directly ready to send. 
- Include relevant elements from my CV to highlight my skills and experience for the position. 
- Use natural, readable language with standard paragraph formatting (no markdown, no brackets, no bullet points). 
- Keep the letter concise, clear, and polite, ready to be sent by email. 
- Do not include placeholders or generic text.
- The letter must be in ${langName}.
- The letter must be between 250 and 400 words.
- Use the job title and the company name in the subject line if possible.
- Use a professional tone suitable for a job application.
- Do not mention that the letter was generated by AI.
- Do not include any notes or explanations outside the letter content.
- Do NOT use any placeholders or text in brackets (e.g., [Your Address], [City], etc.). 
- If the information is not provided in the CV, simply omit it.
Date: ${currentDate}
`;
*/
            const letter = await generateWithGemini(prompt);
            if (letter) {
                output.value = letter;
                
                chrome.storage.local.set({ generatedLetter: letter }, () => {
                    console.log("✅ Letter saved in storage.");
                });

                // ✅ AJOUTER À L'HISTORIQUE
                const response = await getActiveTabText();
                
                // ✅ RÉCUPÉRER L'URL DE L'ONGLET ACTIF (pas window.location.href)
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const jobUrl = tabs[0]?.url || "Unknown URL";  // ✅ URL du job posting
                    
                    chrome.storage.local.get("letterHistory", (data) => {
                        const history = data.letterHistory || [];
                        
                        history.push({
                            id: Date.now(),
                            date: new Date().toLocaleString(),
                            url: jobUrl,  // ✅ URL correcte du posting
                            jobDescription: response?.text || "N/A",
                            letter: letter,
                            language: document.getElementById("languageSelect").value
                        });

                        // Garder les 50 dernières lettres max
                        if (history.length > 50) {
                            history.shift();
                        }

                        chrome.storage.local.set({ letterHistory: history }, () => {
                            console.log("✅ Letter added to history. Total: " + history.length);
                            loadHistory();  // ✅ Recharger l'historique pour voir la nouvelle entrée
                        });
                    });
                });
            } else {
                output.value = "";
            }
        } catch (err) {
            console.error(err);
            
            // ✅ output ET errorMsg existent maintenant
            if (errorMsg) {
                errorMsg.textContent = err.message || "An unexpected error occurred.";
                errorMsg.style.display = "block";
            }
            output.value = err.message || "An error occurred.";
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = "Generate Cover Letter";
        }
    });

    // ===== DOWNLOAD =====
    document.getElementById("downloadBtn").addEventListener("click", async () => {
        chrome.runtime.sendMessage({ action: "downloadLetter" });
    });

    // ===== ADD MANUAL JOB URL =====
    document.getElementById("addManualJobBtn").addEventListener("click", () => {
        // ✅ Récupérer l'URL de l'onglet actif automatiquement
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const jobUrl = tabs[0]?.url || "Unknown URL";

            if (jobUrl === "Unknown URL") {
                alert("⚠️ Could not get the current tab URL");
                return;
            }

            chrome.storage.local.get("letterHistory", (data) => {
                const history = data.letterHistory || [];
                
                history.push({
                    id: Date.now(),
                    date: new Date().toLocaleString(),
                    url: jobUrl,  // ✅ URL de l'onglet actif
                    letter: null,  // ✅ Pas de lettre générée
                    isManual: true  // ✅ Marker pour différencier
                });

                chrome.storage.local.set({ letterHistory: history }, () => {
                    console.log("✅ Job URL added to history: " + jobUrl);
                    loadHistory();  // Recharger l'historique
                });
            });
        });
    });

    // ===== LOAD HISTORY =====


    // Charger l'historique au démarrage
    loadHistory();

    // ===== CLEAR HISTORY =====
    document.getElementById("clearHistoryBtn").addEventListener("click", () => {
        if (confirm("⚠️ Are you sure you want to clear all history?")) {
            chrome.storage.local.set({ letterHistory: [] }, () => {
                loadHistory();
                console.log("✅ History cleared");
            });
        }
    });


    // ===== EXPORT CSV =====
    document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);

});



