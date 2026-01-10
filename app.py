from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import os
import io
import json
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.urandom(24)
CORS(app)

def generate_with_groq(prompt, api_key):
    """Генерация с Groq API"""
    import requests
    
    url = "https://api.groq.com/openai/v1/chat/completions"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    data = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {
                "role": "system",
                "content": "Ты опытный преподаватель. Генерируй экзаменационные вопросы четко по формату."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "max_tokens": 2000,
        "temperature": 0.7
    }
    
    response = requests.post(url, headers=headers, json=data, timeout=30)
    result = response.json()
    
    return result["choices"][0]["message"]["content"]

def generate_with_gemini(prompt, api_key):
    """Генерация с Google Gemini API"""
    from google import genai
    
    client = genai.Client(api_key=api_key)
    
    response = client.models.generate_content(
        model='gemini-2.0-flash-exp',
        contents=prompt
    )
    
    return response.text

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/info.json')
def info():
    """Метаданные для портфолио"""
    return jsonify({
        "title": "📝 Генератор экзаменационных билетов",
        "description": "Профессиональный генератор билетов с ИИ. Поддержка Groq и Gemini. 4 режима работы. Экспорт в Word.",
        "image": "preview.jpg",
        "date": "2025-01-07",
        "tags": ["Образование", "ИИ", "Python", "Flask", "Автоматизация"],
        "hashtags": ["#образование", "#экзамены", "#ии", "#автоматизация", "#учителям", "#преподавателям"]
    })

@app.route('/api/generate', methods=['POST'])
def generate_questions():
    """API для генерации вопросов с ИИ"""
    try:
        data = request.json
        
        provider = data.get('provider')  # groq или gemini
        api_key = data.get('api_key')
        subject = data.get('subject')
        topics = data.get('topics', [])
        mode = data.get('mode')  # 2 или 3
        total_questions = data.get('total_questions', 60)
        difficulty = data.get('difficulty', 'средний')
        
        if not provider or not api_key:
            return jsonify({'error': 'Не указан провайдер или API ключ'}), 400
        
        # Формируем промпт
        if mode == 2:
            # Режим 2: Темы + ИИ
            topics_text = '\n'.join(f"- {topic}" for topic in topics)
            prompt = f"""Ты преподаватель дисциплины "{subject}". 
Сгенерируй {total_questions} экзаменационных вопросов, охватывающих следующие темы:

{topics_text}

Требования:
- Вопросы должны быть конкретными и проверять понимание темы
- Разный уровень сложности
- По {total_questions // len(topics)} вопросов на каждую тему
- Формат: ТОЛЬКО список вопросов, по одному на строку
- БЕЗ нумерации, БЕЗ дополнительного текста, БЕЗ пояснений

Вопросы:"""

        else:
            # Режим 3: Автогенерация
            if topics:
                topics_text = '\n'.join(f"- {topic}" for topic in topics)
                prompt = f"""Ты преподаватель дисциплины "{subject}".
Сгенерируй {total_questions} экзаменационных вопросов уровня сложности "{difficulty}".

Примерные темы для охвата:
{topics_text}

Требования:
- Вопросы должны охватывать указанные темы
- Уровень сложности: {difficulty}
- Разнообразные формулировки
- Формат: ТОЛЬКО список вопросов, по одному на строку
- БЕЗ нумерации, БЕЗ дополнительного текста, БЕЗ пояснений

Вопросы:"""
            else:
                prompt = f"""Ты преподаватель дисциплины "{subject}".
Сгенерируй {total_questions} экзаменационных вопросов уровня сложности "{difficulty}".

Требования:
- Вопросы должны охватывать основные разделы дисциплины
- Уровень сложности: {difficulty}
- Разнообразные формулировки
- Формат: ТОЛЬКО список вопросов, по одному на строку
- БЕЗ нумерации, БЕЗ дополнительного текста, БЕЗ пояснений

Вопросы:"""
        
        # Генерируем вопросы
        if provider == 'groq':
            response_text = generate_with_groq(prompt, api_key)
        elif provider == 'gemini':
            response_text = generate_with_gemini(prompt, api_key)
        else:
            return jsonify({'error': 'Неизвестный провайдер'}), 400
        
        # Парсим вопросы
        questions = []
        for line in response_text.strip().split('\n'):
            line = line.strip()
            # Удаляем нумерацию если есть
            line = line.lstrip('0123456789.-) ')
            if line and len(line) > 10:  # Минимум 10 символов
                questions.append(line)
        
        return jsonify({
            'questions': questions,
            'success': True,
            'count': len(questions)
        })
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'success': False
        }), 500

@app.route('/api/export', methods=['POST'])
def export_tickets():
    """Экспорт билетов в Word/Text"""
    try:
        data = request.json
        tickets = data.get('tickets', [])
        format_type = data.get('format', 'txt')  # txt или docx
        
        if not tickets:
            return jsonify({'error': 'Нет билетов для экспорта'}), 400
        
        # Генерируем текст
        content = ''
        for ticket in tickets:
            content += '═' * 70 + '\n'
            content += f"              ЭКЗАМЕНАЦИОННЫЙ БИЛЕТ № {ticket['number']}\n"
            content += '═' * 70 + '\n\n'
            content += 'Дисциплина: _____________________________________________\n\n'
            content += 'Курс: _____  Группа: _____  Семестр: _____\n\n\n'
            
            for i, question in enumerate(ticket['questions'], 1):
                content += f"{i}. {question}\n\n"
            
            content += '\n\n'
            content += 'Преподаватель: __________________  Дата: __________\n'
            content += '\n\n\n\n'
        
        # Возвращаем контент
        return jsonify({
            'content': content,
            'success': True,
            'filename': f'билеты_{datetime.now().strftime("%Y%m%d_%H%M%S")}.txt'
        })
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'success': False
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
