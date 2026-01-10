# 📦 ВСЕ ФАЙЛЫ ДЛЯ GITHUB

Скопируйте эти файлы в ваш репозиторий https://github.com/pitbul/bilet

---

## 📄 requirements.txt

```
Flask==3.0.0
flask-cors==4.0.0
google-generativeai==0.3.2
requests==2.31.0
gunicorn==21.2.0
```

---

## 📄 Procfile

```
web: gunicorn app:app
```

---

## 📄 render.yaml

```yaml
services:
  - type: web
    name: exam-generator
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn app:app
    envVars:
      - key: PYTHON_VERSION
        value: 3.11.0
```

---

## 📄 .python-version (создайте этот файл тоже)

```
3.11.0
```

---

## 📁 Структура репозитория должна быть:

```
bilet/
├── app.py                    ← Уже есть
├── requirements.txt          ← СОЗДАЙТЕ ЭТОТ!
├── Procfile                  ← СОЗДАЙТЕ ЭТОТ!
├── render.yaml               ← Необязательно
├── .python-version           ← Создайте для Python 3.11
├── templates/
│   └── index.html           ← Уже есть
└── static/
    └── preview.jpg          ← Необязательно
```

---

## 🚀 КАК СОЗДАТЬ ФАЙЛЫ В GITHUB:

### Способ 1: Через веб-интерфейс GitHub

1. Откройте https://github.com/pitbul/bilet
2. Нажмите **"Add file" → "Create new file"**
3. Имя файла: `requirements.txt`
4. Скопируйте содержимое выше
5. Нажмите **"Commit new file"**
6. Повторите для `Procfile` и `.python-version`

### Способ 2: Через командную строку

```bash
# В папке с проектом создайте файлы:

# requirements.txt
echo "Flask==3.0.0
flask-cors==4.0.0
google-generativeai==0.3.2
requests==2.31.0
gunicorn==21.2.0" > requirements.txt

# Procfile
echo "web: gunicorn app:app" > Procfile

# .python-version
echo "3.11.0" > .python-version

# Загрузите на GitHub
git add .
git commit -m "Add deployment files"
git push
```

---

## ✅ ПОСЛЕ СОЗДАНИЯ ФАЙЛОВ:

1. Вернитесь на Render.com
2. Откройте ваш сервис `bilet`
3. Нажмите **"Manual Deploy" → "Clear build cache & deploy"**
4. Подождите 3-5 минут
5. Сайт заработает! 🎉

---

## 📋 ПРОВЕРЬТЕ что все файлы есть:

Зайдите на https://github.com/pitbul/bilet и убедитесь что видите:

✅ app.py  
✅ requirements.txt  
✅ Procfile  
✅ templates/index.html  

Если все 4 файла есть - деплой пройдет успешно!
