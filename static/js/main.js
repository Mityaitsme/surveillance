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

// --- ОТЛАДОЧНАЯ ПАНЕЛЬ НА ЭКРАНЕ ---
// Дублирует console.log/console.error прямо на страницу — на iPhone без Mac
// иначе консоль не увидеть. Временная штука для диагностики TTS/распознавания.
const debugLogEl = document.getElementById('debug-log');
function dbg(msg) {
    console.log(msg);
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
    debugLogEl.appendChild(line);
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
}
function dbgErr(msg) {
    console.error(msg);
    const line = document.createElement('div');
    line.className = 'err';
    line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
    debugLogEl.appendChild(line);
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
}
document.getElementById('debug-clear').onclick = () => { debugLogEl.innerHTML = ''; };

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

// Мобильные браузеры разрешают speechSynthesis.speak() только рядом с прямым
// жестом пользователя. Наш реальный ответ приходит через recognition.onend
// -> fetch -> speak() — несколько шагов асинхронщины спустя после касания,
// из-за чего телефон может молча отказываться его озвучивать (при этом
// субтитры всё равно появляются, т.к. они не зависят от TTS). Поэтому прямо
// в обработчике касания «прогреваем» движок почти беззвучной репликой —
// после этого те же браузеры обычно разрешают озвучивать и последующие,
// асинхронные вызовы speak() в рамках той же сессии.
let ttsUnlocked = false;
function unlockSpeech() {
    if (ttsUnlocked) return;
    ttsUnlocked = true;
    const primer = new SpeechSynthesisUtterance(' ');
    primer.volume = 0.01;
    window.speechSynthesis.speak(primer);
}

// getVoices() на телефоне при первом вызове нередко возвращает пустой список —
// голоса подгружаются асинхронно. Кэшируем через voiceschanged.
let cachedVoices = [];
function refreshVoices() { cachedVoices = window.speechSynthesis.getVoices(); }
window.speechSynthesis.onvoiceschanged = refreshVoices;
refreshVoices();

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

// Субтитры (showBubble) не должны зависеть от того, справится ли сам синтез
// речи — поэтому показываем их всегда, а TTS оборачиваем в try/catch, чтобы
// сбой озвучки никогда не улетал наверх и не путался, например, с сетевой
// ошибкой в вызывающем коде.
function speak(text) {
    showBubble(text);
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
        dbg(`TTS: голосов доступно ${voices.length}, ru-голос ${ruVoice ? 'найден (' + ruVoice.name + ')' : 'НЕ найден, будет голос по умолчанию'}`);
        utterance.pitch = 0.9;
        utterance.onstart = () => dbg("TTS: воспроизведение началось (onstart)");
        utterance.onend = () => { dbg("TTS: воспроизведение закончилось (onend)"); scheduleBubbleHide(); };
        utterance.onerror = (e) => {
            dbgErr("TTS onerror: " + e.error);
            scheduleBubbleHide();
        };
        dbg(`TTS: вызываю speak(), текст: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
        window.speechSynthesis.speak(utterance);
    } catch (err) {
        dbgErr("speak() бросил исключение: " + err);
        scheduleBubbleHide();
    }
}

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
    dbg("── нажатие на колонку ──");
    if (isSpeaking) return;
    if (!recognition) {
        speak("Сэр, это устройство не поддерживает голосовое распознавание.");
        return;
    }
    isSpeaking = true;
    recognizedText = '';
    speakerBtn.classList.add('active');
    // cancel() ДО unlockSpeech() — иначе он тут же обрывает только что
    // поставленную в очередь «прогревочную» реплику, и разблокировки не происходит.
    window.speechSynthesis.cancel();
    unlockSpeech();
    try {
        recognition.start();
        dbg("recognition.start() вызван успешно");
    } catch (err) {
        dbgErr("recognition.start() бросил исключение: " + err);
        isSpeaking = false;
        speakerBtn.classList.remove('active');
        speak("Сэр, не удалось активировать микрофон. Попробуйте ещё раз.");
    }
}

function stopListen() {
    if (!isSpeaking) return;
    dbg("── отпускание колонки ──");
    // Состояние (isSpeaking/active) сбрасывается в onend/onerror — там, где
    // сессия распознавания реально завершилась, а не когда просто отпустили палец.
    setTimeout(() => {
        try { recognition.stop(); } catch (err) { dbgErr("recognition.stop() бросил исключение: " + err); }
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
    dbg("Распознано (промежуточно): " + recognizedText);
};

if (recognition) recognition.onend = async () => {
    dbg("recognition.onend — сессия распознавания завершена");
    isSpeaking = false;
    speakerBtn.classList.remove('active');

    const text = recognizedText.trim();
    recognizedText = '';
    if (text.length < 2) {
        dbg("Распознанный текст пуст — запрос на /ask не отправляю");
        return;
    }

    dbg("Отправляю POST /ask: \"" + text + "\"");

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
        dbg("Ответ от сервера получен, статус: " + res.status);

        const data = await res.json();
        dbg("Ответ сервера: \"" + data.answer + "\"");
        answer = data.answer;
    } catch (e) {
        dbgErr("Ошибка при запросе к /ask: " + e);
        answer = "Простите, сэр, помехи в канале связи.";
    }
    speak(answer);
};

if (recognition) recognition.onerror = (event) => {
    dbgErr("recognition.onerror: " + event.error);
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