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

@app.route('/api/template/download')
def download_template():
    """Скачать шаблон Word"""
    template_content = """МИНИСТЕРСТВО ВЫСШЕГО ОБРАЗОВАНИЯ, НАУКИ И ИННОВАЦИЙ
РЕСПУБЛИКИ УЗБЕКИСТАН

ТАШКЕНТСКИЙ ИНСТИТУТ ТЕКСТИЛЬНОЙ И ЛЕГКОЙ ПРОМЫШЛЕННОСТИ
Кафедра инженерной механики


                                          «УТВЕРЖДАЮ»
                                          Зав. кафедрой __________
                                          «___» _________ 2025 г.



ЭКЗАМЕНАЦИОННЫЙ БИЛЕТ № {ticket_number}


Дисциплина: ______________________________________________________

Направление: _____________________________________________________

Курс: ________  Группа: ________  Семестр: ________



XXX




Преподаватель: ____________________ / _____________ /
                      (подпись)              (Ф.И.О.)

Дата составления: «___» _____________ 2025 г.




═══════════════════════════════════════════════════════════════════

ИНСТРУКЦИЯ ПО ИСПОЛЬЗОВАНИЮ ШАБЛОНА:

1. Отредактируйте шапку (название института, кафедры)
2. Заполните поля дисциплины, направления
3. НЕ УДАЛЯЙТЕ маркеры:
   - {ticket_number} - заменится на номер билета (1, 2, 3...)
   - XXX - заменится на все вопросы билета

4. Сохраните файл
5. В приложении нажмите "Экспорт по шаблону"
6. Загрузите этот файл
7. Получите готовый документ со всеми билетами!
═══════════════════════════════════════════════════════════════════
"""
    
    return jsonify({
        'content': template_content,
        'filename': 'шаблон_билета.txt',
        'success': True
    })

@app.route('/api/template/export', methods=['POST'])
def export_with_template():
    """Экспорт билетов по шаблону"""
    try:
        data = request.json
        tickets = data.get('tickets', [])
        template = data.get('template', '')
        
        if not tickets:
            return jsonify({'error': 'Нет билетов для экспорта'}), 400
        
        if not template:
            return jsonify({'error': 'Шаблон не загружен'}), 400
        
        # Генерируем все билеты
        full_document = ''
        
        for i, ticket in enumerate(tickets):
            # Форматируем вопросы
            questions_text = ''
            for j, question in enumerate(ticket['questions'], 1):
                questions_text += f"{j}. {question}\n\n"
            
            # Заменяем маркеры в шаблоне
            ticket_text = template.replace('{ticket_number}', str(ticket['number']))
            ticket_text = ticket_text.replace('XXX', questions_text.strip())
            ticket_text = ticket_text.replace('{questions}', questions_text.strip())
            
            full_document += ticket_text
            
            # Разделитель между билетами (кроме последнего)
            if i < len(tickets) - 1:
                full_document += '\n\n\n' + '═' * 70 + '\n\n\n'
        
        return jsonify({
            'content': full_document,
            'success': True,
            'filename': f'билеты_по_шаблону_{datetime.now().strftime("%Y%m%d_%H%M%S")}.txt'
        })
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'success': False
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
