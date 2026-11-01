const $ = (id) => document.getElementById(id);

let currentDeterrent = { active: false, tier: 0, led: "off" };
let lastDeterrentKey = "";
let lastCameraKey = "";
let ledTimer = null;
let ledMode = "off";
let audioCtx = null;

async function api(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error("Request failed: " + response.status);
    }
    return response.json();
}

function getAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
        return null;
    }
    if (!audioCtx) {
        audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
    return audioCtx;
}

function playDeterrentAudio(type, visit) {
    try {
        const actx = getAudio();
        if (!actx) {
            return;
        }
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.connect(gain);
        gain.connect(actx.destination);
        const now = actx.currentTime;

        if (type === "boar") {
            const tier = Math.min(Number(visit) || 1, 3);
            if (tier === 1) {
                osc.type = "sine";
                osc.frequency.setValueAtTime(800, now);
                gain.gain.setValueAtTime(0.2, now);
                osc.start();
                osc.stop(now + 1.0);
            } else if (tier === 2) {
                osc.type = "sawtooth";
                osc.frequency.setValueAtTime(1200, now);
                gain.gain.setValueAtTime(0.2, now);
                osc.start();
                osc.stop(now + 1.2);
            } else {
                osc.type = "triangle";
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.linearRampToValueAtTime(1500, now + 0.3);
                osc.frequency.linearRampToValueAtTime(600, now + 0.6);
                osc.frequency.linearRampToValueAtTime(1500, now + 0.9);
                osc.frequency.linearRampToValueAtTime(600, now + 1.2);
                gain.gain.setValueAtTime(0.25, now);
                osc.start();
                osc.stop(now + 1.4);
            }
        } else if (type === "other") {
            osc.type = "sine";
            osc.frequency.setValueAtTime(450, now);
            gain.gain.setValueAtTime(0.1, now);
            osc.start();
            osc.stop(now + 0.5);
        }
    } catch (error) {
        console.log("Audio not available:", error);
    }
}

function setCard(name, info) {
    const card = $("card-" + name);
    card.className = "card level-" + info.level;
    $(name + "-value").textContent = info.value;
    $(name + "-detail").textContent = info.detail;
}

function stopLedLoop() {
    if (ledTimer !== null) {
        clearTimeout(ledTimer);
        ledTimer = null;
    }
}

function randomLedLoop() {
    if (ledMode !== "random") {
        return;
    }
    $("led").classList.toggle("led-solid");
    ledTimer = setTimeout(randomLedLoop, 40 + Math.random() * 220);
}

function setLed(mode) {
    const led = $("led");
    stopLedLoop();
    ledMode = mode;
    led.classList.remove("led-solid", "led-strobe");
    if (mode === "solid") {
        led.classList.add("led-solid");
        $("led-label").textContent = "CONTINUOUS WHITE LED";
    } else if (mode === "strobe") {
        led.classList.add("led-strobe");
        $("led-label").textContent = "FAST STROBE LED";
    } else if (mode === "random") {
        $("led-label").textContent = "RANDOMIZED HIGH-FREQUENCY FLASH";
        randomLedLoop();
    } else {
        $("led-label").textContent = "LED OFF";
    }
}

function updateCamera(status) {
    const box = $("aiBox");
    const label = $("aiBoxLabel");
    const animal = $("animalSilhouette");
    const msg = $("cameraStatusMsg");

    const match = status.camera.detail.match(/(\d+)%/);
    const confidence = match ? match[1] : "0";
    const key = status.scenario + "-" + status.visit_count + "-" + confidence;
    if (key === lastCameraKey) {
        return;
    }
    lastCameraKey = key;

    if (status.scenario === "boar") {
        box.className = "ai-bounding-box";
        box.style.left = (10 + Math.random() * 50) + "%";
        box.style.top = (15 + Math.random() * 30) + "%";
        box.style.display = "flex";
        label.textContent = "Wild Boar: " + confidence + "% [Visit #" + status.visit_count + "]";
        animal.textContent = "🐗";
        msg.textContent = "TARGET LOCKED - WILD BOAR - DETERRENT ENGAGED";
    } else if (status.scenario === "other") {
        box.className = "ai-bounding-box other";
        box.style.left = (10 + Math.random() * 50) + "%";
        box.style.top = (15 + Math.random() * 30) + "%";
        box.style.display = "flex";
        label.textContent = "Non-Target: " + confidence + "%";
        animal.textContent = "🐕";
        msg.textContent = "NON-TARGET MOVEMENT - PASSIVE WATCH";
    } else {
        box.style.display = "none";
        msg.textContent = "FIELD PERIMETER CLEAR - SCANNING";
    }
}

function renderStatus(status) {
    setCard("pir", status.pir);
    setCard("camera", status.camera);
    setCard("esp32", status.esp32);
    setCard("deterrent", status.deterrent);
    $("visit-count").textContent = status.visit_count;
    updateCamera(status);

    currentDeterrent = status.deterrent;
    const key = status.deterrent.active + "-" + status.deterrent.tier;
    if (key !== lastDeterrentKey) {
        lastDeterrentKey = key;
        setLed(status.deterrent.led);
        const buzzer = $("buzzer-state");
        if (status.deterrent.active) {
            buzzer.textContent = "SOUNDING (TIER " + status.deterrent.tier + ")";
            buzzer.classList.add("on");
        } else {
            buzzer.textContent = "OFF";
            buzzer.classList.remove("on");
        }
    }
}

function statusPillClass(status) {
    if (status === "Deterrent Activated") {
        return "pill-alert";
    }
    if (status === "Ignored") {
        return "pill-muted";
    }
    return "pill-ok";
}

function renderEvents(events) {
    const body = $("events-body");
    body.innerHTML = "";

    if (events.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 6;
        cell.className = "empty";
        cell.textContent = "No events yet. Trigger a simulation to see history.";
        row.appendChild(cell);
        body.appendChild(row);
        return;
    }

    events.forEach((event) => {
        const row = document.createElement("tr");
        const visitText = event.visit_count > 0 ? String(event.visit_count) : "-";
        const values = [event.id, event.timestamp, event.entity, visitText, event.action];

        values.forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });

        const statusCell = document.createElement("td");
        const pill = document.createElement("span");
        pill.className = "status-pill " + statusPillClass(event.status);
        pill.textContent = event.status;
        statusCell.appendChild(pill);
        row.appendChild(statusCell);

        body.appendChild(row);
    });
}

async function refreshStatus() {
    try {
        renderStatus(await api("/api/status"));
    } catch (error) {
        $("message").textContent = "Cannot reach server. Is app.py running?";
    }
}

async function refreshEvents() {
    try {
        renderEvents(await api("/api/events"));
    } catch (error) {
        $("message").textContent = "Cannot load history from server.";
    }
}

async function sendSimulation(type) {
    getAudio();
    try {
        const result = await api("/api/simulate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: type }),
        });
        $("message").textContent = result.message;
        renderStatus(result.status);
        await refreshEvents();
        if (type === "boar" || type === "other") {
            playDeterrentAudio(type, result.status.visit_count);
        }
    } catch (error) {
        $("message").textContent = "Simulation failed: " + error.message;
    }
}

async function resetAll() {
    if (!window.confirm("Clear all history and reset the visit counter to 0?")) {
        return;
    }
    try {
        const result = await api("/api/reset", { method: "POST" });
        $("message").textContent = result.message;
        lastCameraKey = "";
        renderStatus(result.status);
        await refreshEvents();
    } catch (error) {
        $("message").textContent = "Reset failed: " + error.message;
    }
}

function resizeCanvas() {
    const canvas = $("wave");
    canvas.width = canvas.clientWidth;
}

function drawWave(timestamp) {
    const canvas = $("wave");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;
    const t = timestamp / 1000;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    const tier = currentDeterrent.active ? currentDeterrent.tier : 0;
    let readout = "0 kHz - Silent";
    let color = "#475569";

    ctx.beginPath();
    ctx.lineWidth = 2;

    if (tier === 0) {
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
    } else if (tier === 1) {
        color = "#4ade80";
        readout = "22.0 kHz (fixed) - Soft Alert [SIMULATED]";
        for (let x = 0; x <= w; x++) {
            const y = mid + h * 0.3 * Math.sin(x * 0.09 - t * 14);
            if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
    } else if (tier === 2) {
        color = "#fbbf24";
        const khz = 30 + 2 * Math.sin(t * 4);
        readout = khz.toFixed(1) + " kHz (sweeping 28-32 kHz) - High Intensity [SIMULATED]";
        const k = khz * 0.0045;
        for (let x = 0; x <= w; x++) {
            const y = mid + h * 0.4 * Math.sin(x * k - t * 22);
            if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
    } else {
        color = "#f87171";
        readout = "Bio-acoustic distress siren - wide sweep [SIMULATED]";
        const sweep = 0.05 + 0.05 * (Math.sin(t * 3) + 1);
        const pulse = 0.35 + 0.1 * Math.sin(t * 9);
        for (let x = 0; x <= w; x++) {
            const noise = (Math.random() - 0.5) * 0.25 * h * 0.4;
            const y = mid + h * pulse * Math.sin(x * sweep - t * 30) + noise;
            if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
    }

    ctx.strokeStyle = color;
    ctx.stroke();
    $("freq-readout").textContent = readout;

    requestAnimationFrame(drawWave);
}

document.querySelectorAll("[data-sim]").forEach((button) => {
    button.addEventListener("click", () => sendSimulation(button.dataset.sim));
});

$("reset-all").addEventListener("click", resetAll);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
requestAnimationFrame(drawWave);
refreshStatus();
refreshEvents();
setInterval(refreshStatus, 2000);
setInterval(refreshEvents, 3000);
// ==========================================================
// 3-Tier Multi-Audio Controller (Dog, Man, Lion)
// ==========================================================
const soundDog = new Audio("/static/audio/dog.mp3");
const soundMan = new Audio("/static/audio/man.mp3");
const soundLion = new Audio("/static/audio/lion.mp3");

// முந்தைய சத்தங்கள் அனைத்தையும் உடனே நிறுத்தும் Function
function stopAllSounds() {
    [soundDog, soundMan, soundLion].forEach(audio => {
        try {
            audio.pause();
            audio.currentTime = 0;
        } catch (e) {}
    });
}

function playDeterrentAudio(scenario, visit) {
    // புதிய சத்தம் தொடங்கும் முன் பழைய சத்தத்தை நிறுத்துதல்
    stopAllSounds();

    const v = Number(visit) || 1;

    try {
        if (scenario === "boar" || scenario === "wild_boar") {
            if (v === 1) {
                // Tier 1: நாய் சத்தம் (Dog)
                console.log("Playing Tier 1: Dog sound");
                soundDog.play().catch(e => console.log("Audio waiting for user click:", e));
            } else if (v === 2) {
                // Tier 2: மனிதன் விரட்டும் சத்தம் (Man)
                console.log("Playing Tier 2: Man scream sound");
                soundMan.play().catch(e => console.log("Audio waiting for user click:", e));
            } else {
                // Tier 3+: சிங்கம் கர்ஜிக்கும் சத்தம் (Lion)
                console.log("Playing Tier 3: Lion roar sound");
                soundLion.play().catch(e => console.log("Audio waiting for user click:", e));
            }
        } else if (scenario === "other" || scenario === "stray") {
            // Non-Target Stray Animal: நாய் சத்தம் (Dog)
            console.log("Playing Stray Animal: Dog sound");
            soundDog.play().catch(e => console.log("Audio waiting for user click:", e));
        } else if (scenario === "clear") {
            stopAllSounds();
        }
    } catch (err) {
        console.error("Audio error:", err);
    }
}

// பட்டன் அழுத்தியவுடன் சத்தத்தை இயக்கும் கண்காணிப்பு லூப்
let lastAudioKey = "";

setInterval(async () => {
    try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = await res.json();

        const scenario = data.scenario;
        const visit = data.visit_count !== undefined ? data.visit_count : (data.consecutive_boar_visits || 0);
        const currentKey = scenario + "-" + visit;

        if (scenario && scenario !== "clear" && currentKey !== lastAudioKey) {
            lastAudioKey = currentKey;
            playDeterrentAudio(scenario, visit);
        } else if (scenario === "clear" && lastAudioKey !== "clear") {
            lastAudioKey = "clear";
            stopAllSounds();
        }
    } catch (err) {}
}, 300);