let currentRoomId = 'living_room';
let currentTimeSec = 5 * 3600;
let isSpeaking = false;

const slider = document.getElementById('time-slider');
const fineSlider = document.getElementById('fine-slider');
const roomBg = document.getElementById('room-bg');
const timeDisplay = document.getElementById('display-time');
const roomNameDisplay = document.getElementById('room-name');
const roomNavContainer = document.getElementById('room-nav');
const speakerBtn = document.getElementById('smart-speaker');
const stage = document.getElementById('stage');
const bubble = document.getElementById('speech-bubble');
const bubbleText = document.getElementById('speech-bubble-text');

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognitionCtor ? new SpeechRecognitionCtor() : null;
if (recognition) recognition.lang = 'ru-RU';

// --- НАВИГАЦИЯ ---
function changeRoom(id) {
    if (!window.ROOMS_CONFIG || !window.ROOMS_CONFIG[id]) return;
    currentRoomId = id;
    const room = window.ROOMS_CONFIG[id];
    roomNameDisplay.innerText = room.name.toUpperCase();
    renderNav(room);
    updateSpeaker(room);
    updateView();
}

function renderNav(room) {
    roomNavContainer.innerHTML = '';
    (room.nav || []).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = item.label;
        btn.onclick = () => changeRoom(item.target);
        roomNavContainer.appendChild(btn);
    });
}

// Колонка физически стоит только в одной комнате — в остальных зона скрыта
// и, соответственно, недоступна для клика/тача.
function updateSpeaker(room) {
    if (room.speaker) {
        speakerBtn.style.display = 'block';
        speakerBtn.style.left = room.speaker.left + '%';
        speakerBtn.style.top = room.speaker.top + '%';
        speakerBtn.style.width = room.speaker.size + '%';
    } else {
        speakerBtn.style.display = 'none';
        stopListen();
    }
}

// --- МАСШТАБИРОВАНИЕ ПОД ЭКРАН ---
// В портретной ориентации контент просто центрируется по вертикали (flex на body).
// В альбомной, где высоты экрана телефона не хватает под соотношение 4:3, сцену
// целиком уменьшаем, чтобы всё помещалось без обрезки и скролла.
function fitStage() {
    stage.style.transform = 'scale(1)';
    const rect = stage.getBoundingClientRect();
    const scale = Math.min(1, window.innerHeight / rect.height);
    stage.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fitStage);
window.addEventListener('orientationchange', fitStage);

// --- ВИЗУАЛ ---
function updateView() {
    const hours = Math.floor(currentTimeSec / 3600);
    const mins = Math.floor((currentTimeSec % 3600) / 60);
    const secs = currentTimeSec % 60;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    timeDisplay.innerText = timeStr;
    const room = window.ROOMS_CONFIG[currentRoomId];
    roomBg.src = `/static/images/${getCurrentFrame(room)}`;

    // Ночью запись темнее, к утру постепенно светлеет (шаг на границе 6:00/21:00).
    let brightness = (hours < 6 || hours > 21) ? 72 : 130;
    roomBg.style.filter = `brightness(${brightness}%)`;
}

// До наступления события — кадр по умолчанию. С момента события каждые
// interval_sec секунд показывается следующий кадр, последний остаётся до конца.
function getCurrentFrame(room) {
    if (!room.event) return room.default_frame;

    const [h, m, s] = room.event.trigger_time.split(':').map(Number);
    const triggerSec = h * 3600 + m * 60 + s;
    const diff = currentTimeSec - triggerSec;

    if (diff < 0) return room.default_frame;

    const frames = room.event.frames;
    const index = Math.min(Math.floor(diff / room.event.interval_sec), frames.length - 1);
    return frames[index];
}

// --- ГОЛОС ---
const BUBBLE_MAX_CHARS = 240;
const BUBBLE_HOLD_MS = 2000;
let bubbleHideTimer = null;
let bubbleFadeTimer = null;

function showBubble(text) {
    clearTimeout(bubbleHideTimer);
    clearTimeout(bubbleFadeTimer);
    const truncated = text.length > BUBBLE_MAX_CHARS
        ? text.slice(0, BUBBLE_MAX_CHARS).trimEnd() + '…'
        : text;
    bubbleText.textContent = truncated;
    bubble.classList.remove('fade-out');
    bubble.classList.add('visible');
}

// Держим окошко пару секунд после конца реплики, потом плавно гасим (CSS-transition).
function scheduleBubbleHide() {
    clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(() => {
        bubble.classList.add('fade-out');
        bubbleFadeTimer = setTimeout(() => {
            bubble.classList.remove('visible', 'fade-out');
        }, 800); // должно совпадать с transition в CSS
    }, BUBBLE_HOLD_MS);
}

function speak(text) {
    window.speechSynthesis.cancel();
    showBubble(text);
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(v => v.lang.includes('ru'));
    utterance.pitch = 0.9;
    utterance.onend = scheduleBubbleHide;
    utterance.onerror = scheduleBubbleHide;
    window.speechSynthesis.speak(utterance);
}

// --- КОЛОНКА ---
function startListen(e) {
    if (e) e.preventDefault();
    if (isSpeaking) return;
    if (!recognition) {
        speak("Сэр, это устройство не поддерживает голосовое распознавание.");
        return;
    }
    isSpeaking = true;
    speakerBtn.classList.add('active');
    window.speechSynthesis.cancel();
    try { recognition.start(); } catch(err) {}
}

function stopListen() {
    if (!isSpeaking) return;
    isSpeaking = false;
    speakerBtn.classList.remove('active');
    setTimeout(() => { recognition.stop(); }, 400);
}

// Pointer Events объединяют мышь/тач/перо в одном API и не страдают от
// «призрачных» дублирующихся mouse-событий после touch на мобильных браузерах,
// из-за которых зажатие могло не срабатывать на телефоне.
speakerBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { speakerBtn.setPointerCapture(e.pointerId); } catch (err) {}
    startListen(e);
});
speakerBtn.addEventListener('pointerup', stopListen);
speakerBtn.addEventListener('pointercancel', stopListen);

if (recognition) recognition.onresult = async (event) => {
    const text = event.results[0][0].transcript;
    console.log("%c[JS] Распознано: " + text, "color: yellow");
    
    if (text.length < 2) return;

    console.log("[JS] Отправляю POST запрос на /ask...");
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // Таймаут 10 сек

        const res = await fetch('/ask', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message: text}),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log("[JS] Ответ от сервера получен, статус:", res.status);
        
        const data = await res.json();
        console.log("[JS] Тест ответа:", data.answer);
        speak(data.answer);
    } catch(e) {
        console.error("[JS ERROR] Ошибка при запросе:", e);
        speak("Простите, сэр, помехи в канале связи.");
    }
};

if (recognition) recognition.onerror = (event) => {
    console.error("[JS ERROR] Распознавание речи:", event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        speak("Сэр, нет доступа к микрофону. Проверьте разрешения браузера.");
    }
};

// --- ЗАПУСК ---
setInterval(() => {
    currentTimeSec++;
    if (currentTimeSec >= 86400) currentTimeSec = 0;
    slider.value = currentTimeSec;
    updateView();
}, 1000);

slider.oninput = () => {
    currentTimeSec = parseInt(slider.value);
    updateView();
};

// Джог-слайдер точной перемотки: ±10 минут от текущего момента.
// Якорь фиксируется в начале жеста, а после отпускания ползунок
// возвращается в центр — как колёсико точной перемотки.
let fineSliderAnchor = currentTimeSec;

fineSlider.addEventListener('pointerdown', () => {
    fineSliderAnchor = currentTimeSec;
});

fineSlider.oninput = () => {
    let t = fineSliderAnchor + parseInt(fineSlider.value);
    t = Math.max(0, Math.min(86399, t));
    currentTimeSec = t;
    slider.value = currentTimeSec;
    updateView();
};

fineSlider.addEventListener('pointerup', () => {
    fineSlider.value = 0;
});

changeRoom(currentRoomId);
fitStage();