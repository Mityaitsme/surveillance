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
    // Оба значения подняты на одинаковую величину — разница между днём и ночью не меняется.
    let brightness = (hours < 6 || hours > 21) ? 87 : 145;
    roomBg.style.filter = `brightness(${brightness}%)`;
}

// До наступления события — кадр по умолчанию. С момента события каждые
// interval_sec секунд показывается следующий кадр. После последнего кадра
// либо остаётся на нём (по умолчанию, как в гостиной), либо, если у события
// стоит revert_to_default, возвращается к дефолтному кадру и висит на нём
// до конца (как на кухне: тень прошла и на этом всё).
function getCurrentFrame(room) {
    if (!room.event) return room.default_frame;

    const [h, m, s] = room.event.trigger_time.split(':').map(Number);
    const triggerSec = h * 3600 + m * 60 + s;
    const diff = currentTimeSec - triggerSec;

    if (diff < 0) return room.default_frame;

    const frames = room.event.frames;
    const rawIndex = Math.floor(diff / room.event.interval_sec);

    if (rawIndex >= frames.length) {
        return room.event.revert_to_default ? room.default_frame : frames[frames.length - 1];
    }
    return frames[rawIndex];
}

// --- ГОЛОС ---
const BUBBLE_MAX_CHARS = 240;
const BUBBLE_HOLD_MS = 2000;
const BUBBLE_FADE_MS = 1100; // должно совпадать с transition в CSS
let bubbleHideTimer = null;
let bubbleFadeTimer = null;

// getVoices() на телефоне при первом вызове нередко возвращает пустой список —
// голоса подгружаются асинхронно. Кэшируем через voiceschanged.
let cachedVoices = [];
function refreshVoices() { cachedVoices = window.speechSynthesis.getVoices(); }
window.speechSynthesis.onvoiceschanged = refreshVoices;
refreshVoices();

// Субтитры живут по своему таймеру независимо от звука — исчезают через
// пару секунд сами по себе, и включение/выключение озвучки их не трогает.
function showBubble(text) {
    clearTimeout(bubbleHideTimer);
    clearTimeout(bubbleFadeTimer);
    const truncated = text.length > BUBBLE_MAX_CHARS
        ? text.slice(0, BUBBLE_MAX_CHARS).trimEnd() + '…'
        : text;
    bubbleText.textContent = truncated;
    bubble.classList.remove('fade-out');
    bubble.classList.add('visible');

    bubbleHideTimer = setTimeout(() => {
        bubble.classList.add('fade-out');
        bubbleFadeTimer = setTimeout(() => {
            bubble.classList.remove('visible', 'fade-out');
        }, BUBBLE_FADE_MS);
    }, BUBBLE_HOLD_MS);
}

// Последний ответ колонки — хранится, чтобы при включении звука можно было
// озвучить его без повторного показа субтитров (они уже отыграли своё).
let lastAnswer = '';

// Собственно звук, отдельно от субтитров: используется и в speak() (когда
// озвучка включена), и напрямую при клике по переключателю ниже.
function playVoice(text) {
    try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume(); // Chrome иногда «залипает» в paused-состоянии
        const utterance = new SpeechSynthesisUtterance(text);
        // Явно указываем язык — без этого некоторые движки на Android молча
        // отказываются озвучивать кириллицу, если не могут определить язык сами.
        utterance.lang = 'ru-RU';
        // Свежий список голосов приоритетнее кэша: на части Android-браузеров
        // объекты голосов из старого снимка становятся невалидными, и speak()
        // с ними может молча ничего не произнести.
        const freshVoices = window.speechSynthesis.getVoices();
        const voices = freshVoices.length ? freshVoices : cachedVoices;
        const ruVoice = voices.find(v => v.lang.includes('ru'));
        if (ruVoice) utterance.voice = ruVoice;
        utterance.pitch = 0.9;
        utterance.onerror = (e) => console.error("[JS ERROR] TTS:", e.error);
        window.speechSynthesis.speak(utterance);
    } catch (err) {
        console.error("[JS ERROR] playVoice():", err);
    }
}

// Субтитры показываются всегда; звук — только если озвучка включена.
function speak(text) {
    lastAnswer = text;
    showBubble(text);
    if (voiceEnabled) playVoice(text);
}

// --- ПЕРЕКЛЮЧАТЕЛЬ ОЗВУЧКИ ---
// По умолчанию выключена на любом устройстве. Включение — это прямой клик
// пользователя, а не отложенный вызов после распознавания/сети, поэтому
// именно им (а не «прогревочной» тишиной) надёжно разблокируется синтез речи
// даже на iOS: см. предыдущий эксперимент с кликабельным облачком. Субтитры
// при этом заново не показываем — они уже отыграли своё.
let voiceEnabled = false;
const voiceToggleBtn = document.getElementById('voice-toggle');
const voiceToggleIcon = document.getElementById('voice-toggle-icon');

function setVoiceEnabled(enabled) {
    voiceEnabled = enabled;
    voiceToggleIcon.src = enabled ? '/static/images/sound.png' : '/static/images/mute.png';
    if (!enabled) window.speechSynthesis.cancel();
}

voiceToggleBtn.addEventListener('click', () => {
    if (voiceEnabled) {
        setVoiceEnabled(false);
        return;
    }
    setVoiceEnabled(true);
    playVoice(lastAnswer || 'Звук включён, сэр.');
});

// --- КОЛОНКА ---
// По умолчанию (continuous=false) распознавание на мобильном Chrome само
// обрывается почти сразу после первой же паузы в речи — независимо от того,
// держит ли пользователь кнопку — из-за чего долгое удержание с речью не
// работало. continuous=true держит сессию активной, пока мы явно не вызовем
// stop() по отпусканию кнопки; результат отправляется на /ask только когда
// сессия реально завершилась (onend), а не на каждый промежуточный кусок речи.
if (recognition) {
    recognition.continuous = true;
    recognition.interimResults = false;
}

let recognizedText = '';

function startListen(e) {
    if (e) e.preventDefault();
    if (isSpeaking) return;
    if (!recognition) {
        speak("Сэр, это устройство не поддерживает голосовое распознавание.");
        return;
    }
    isSpeaking = true;
    recognizedText = '';
    speakerBtn.classList.add('active');
    window.speechSynthesis.cancel();
    try {
        recognition.start();
    } catch (err) {
        console.error("[JS ERROR] recognition.start():", err);
        isSpeaking = false;
        speakerBtn.classList.remove('active');
        speak("Сэр, не удалось активировать микрофон. Попробуйте ещё раз.");
    }
}

function stopListen() {
    if (!isSpeaking) return;
    // Состояние (isSpeaking/active) сбрасывается в onend/onerror — там, где
    // сессия распознавания реально завершилась, а не когда просто отпустили палец.
    setTimeout(() => {
        try { recognition.stop(); } catch (err) {}
    }, 400);
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

if (recognition) recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
            recognizedText += event.results[i][0].transcript;
        }
    }
    console.log("%c[JS] Распознано (промежуточно): " + recognizedText, "color: yellow");
};

if (recognition) recognition.onend = async () => {
    isSpeaking = false;
    speakerBtn.classList.remove('active');

    const text = recognizedText.trim();
    recognizedText = '';
    if (text.length < 2) return;

    console.log("[JS] Отправляю POST запрос на /ask...", text);

    // speak() вызывается один раз, СНАРУЖИ try — иначе сбой в самом синтезе
    // речи попадёт в тот же catch и ошибочно озвучится как сетевая проблема,
    // хотя ответ от сервера пришёл нормально.
    let answer;
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
        answer = data.answer;
    } catch (e) {
        console.error("[JS ERROR] Ошибка при запросе:", e);
        answer = "Простите, сэр, помехи в канале связи.";
    }
    speak(answer);
};

if (recognition) recognition.onerror = (event) => {
    console.error("[JS ERROR] Распознавание речи:", event.error);
    isSpeaking = false;
    speakerBtn.classList.remove('active');
    recognizedText = '';

    const messages = {
        'not-allowed': "Сэр, нет доступа к микрофону. Проверьте разрешения браузера.",
        'service-not-allowed': "Сэр, нет доступа к микрофону. Проверьте разрешения браузера.",
        'no-speech': "Сэр, я не расслышал. Попробуйте ещё раз.",
        'audio-capture': "Сэр, микрофон не обнаружен.",
        'network': "Сэр, нет соединения с сервисом распознавания речи."
    };
    speak(messages[event.error] || "Сэр, произошла ошибка распознавания речи.");
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