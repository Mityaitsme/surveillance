import requests
import uuid
import urllib3
import os
from flask import Flask, render_template, request, jsonify

# Отключаем надоедливые предупреждения об отсутствии сертификатов
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)

# ТВОИ ДАННЫЕ ИЗ ЛИЧНОГО КАБИНЕТА
AUTH_KEY = os.getenv("AUTH_KEY")

def get_gigachat_token():
    """Получает Access token согласно документации Сбера"""
    url = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    
    # Генерация уникального RqUID (обязательно!)
    rquid = str(uuid.uuid4())
    
    payload = { 'scope': 'GIGACHAT_API_PERS' }
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'RqUID': rquid,
        'Authorization': f'Basic {AUTH_KEY}'
    }

    try:
        # verify=False нужен, так как у Сбера спец. сертификаты
        response = requests.post(url, headers=headers, data=payload, verify=False)
        if response.status_code == 200:
            return response.json().get('access_token')
        else:
            print(f"[TOKEN ERROR] Status: {response.status_code}, Text: {response.text}")
            return None
    except Exception as e:
        print(f"[TOKEN EXCEPTION] {e}")
        return None

def ask_gigachat(user_text, token):
    """Отправляет запрос в GigaChat через проверенный временем адрес"""
    # Используем основной адрес API
    url = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
    
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    
    payload = {
        # Попробуй сначала "GigaChat", если не сработает - "GigaChat:latest"
        "model": "GigaChat", 
        "messages": [
            {
                "role": "system",
                "content": "Ты Джарвис, вежливый ИИ. Отвечай кратко, называй пользователя сэр."
            },
            {
                "role": "user",
                "content": user_text
            }
        ],
        "temperature": 0.7
    }

    try:
        # verify=False критичен, если не стоят сертификаты Сбера
        response = requests.post(url, headers=headers, json=payload, verify=False)
        
        if response.status_code == 200:
            return response.json()['choices'][0]['message']['content']
        else:
            # Если 404 повторится, мы выведем в консоль список доступных моделей
            print(f"[AI ERROR] Status: {response.status_code}, Text: {response.text}")
            return None
    except Exception as e:
        print(f"[AI EXCEPTION] {e}")
        return None

@app.route('/ask', methods=['POST'])
def ask_ai():
    data = request.json
    user_text = data.get("message", "").lower().strip()
    print(f"[JARVIS] Вопрос: {user_text}")

    # 1. Сюжетный триггер
    if any(word in user_text for word in ["рубик", "кубик", "пропал", "вор"]):
        return jsonify({"answer": "Сэр, нашел результат в интернете - реддит-сообщество r/LostRubiks"})

    # 2. GigaChat
    token = get_gigachat_token()
    if token:
        answer = ask_gigachat(user_text, token)
        if answer:
            return jsonify({"answer": answer})
    
    return jsonify({"answer": "Сэр, зафиксированы помехи в канале связи. Попробуйте еще раз."})


ROOMS = {
    "living_room": {
        "id": "living_room",
        "name": "Гостиная",
        "default_frame": "l_0.png",
        "event": {
            # l_0 до 04:09:05 включительно, далее каждые 5 сек l_1 -> l_2 -> l_3
            "trigger_time": "04:09:10",
            "interval_sec": 5,
            "frames": ["l_1.png", "l_2.png", "l_3.png"]
        },
        "nav": [
            {"label": "← Кухня", "target": "kitchen"},
            {"label": "↓ Спальня", "target": "bedroom"}
        ]
    },
    "kitchen": {
        "id": "kitchen",
        "name": "Кухня",
        "default_frame": "k_0.png",
        "event": {
            # k_0 до 04:09:04 включительно, далее каждые 5 сек k_1 -> k_2 -> k_3 -> k_4,
            # а с 04:09:25 — снова k_0 (revert_to_default) и так до конца.
            "trigger_time": "04:09:05",
            "interval_sec": 5,
            "frames": ["k_1.png", "k_2.png", "k_3.png", "k_4.png"],
            "revert_to_default": True
        },
        "nav": [
            {"label": "↓ Спальня", "target": "bedroom"},
            {"label": "→ Гостиная", "target": "living_room"}
        ]
    },
    "bedroom": {
        "id": "bedroom",
        "name": "Спальня",
        "default_frame": "bedroom.png",
        "nav": [
            {"label": "← Кухня", "target": "kitchen"},
            {"label": "↑ Гостиная", "target": "living_room"}
        ],
        "speaker": {"left": 76.5, "top": 46.3, "size": 13}
    }
}

@app.route('/')
def index():
    return render_template('index.html', rooms=ROOMS)

if __name__ == '__main__':
    app.run(debug=True, port=5000)