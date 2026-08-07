# AI Animated Slideshow Editor – Initial Setup Guide

## Technology Stack

### Frontend

* **React 19** – UI framework
* **TypeScript** – type-safe development
* **Vite** – frontend build tool and development server
* **PixiJS 8** – GPU-accelerated 2D rendering engine
* **Material UI (MUI)** – user interface components
* **Zustand** – client state management
* **TanStack Query** – backend communication and caching
* **React Flow** – node/graph editor (storyboards, workflows)
* **Monaco Editor** – shader, JSON and prompt editor
* **Axios** – HTTP client

---

### Backend

* **Python 3.12**
* **FastAPI** – REST API
* **Pydantic** – data validation
* **SQLAlchemy** – ORM
* **LangGraph** – AI workflow orchestration
* **LangChain** – LLM integrations
* **Pillow** – image processing
* **Uvicorn** – ASGI server

---

### Database

* SQLite (prototype)

---

### AI

* OpenAI API
* LangGraph
* LangChain

---

### Rendering

* PixiJS
* GLSL shaders

---

### Video Export

* FFmpeg

---

### Package Managers

Frontend

* npm

Backend

* uv

---

### Version Control

* Git

---

# Initial Installation

## 1. Install Node.js

Install **Node.js 22 LTS**

Verify installation:

```bash
node -v
npm -v
```

---

## 2. Install Python

Install **Python 3.12**

Verify:

```bash
python3 --version
```

---

## 3. Install uv

macOS / Linux

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Verify:

```bash
uv --version
```

---

## 4. Install Git

Verify:

```bash
git --version
```

---

## 5. Install FFmpeg

macOS

```bash
brew install ffmpeg
```

Verify:

```bash
ffmpeg -version
```

---

# Frontend Setup

Create the frontend project:

```bash
npm create vite@latest frontend
```

Select:

* React
* TypeScript

Enter the project:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Install project libraries:

```bash
npm install \
pixi.js \
@mui/material \
@emotion/react \
@emotion/styled \
zustand \
@tanstack/react-query \
reactflow \
axios \
monaco-editor \
@monaco-editor/react
```

Start the frontend:

```bash
npm run dev
```

The application will be available at:

```
http://localhost:5173
```

---

# Backend Setup

Create backend directory:

```bash
mkdir backend
cd backend
```

Initialize project:

```bash
uv init
```

Create virtual environment:

```bash
uv venv
```

Activate environment:

macOS / Linux

```bash
source .venv/bin/activate
```

Install backend dependencies:

```bash
uv add \
fastapi \
uvicorn \
sqlalchemy \
pydantic \
langgraph \
langchain \
python-multipart \
pillow
```

Run backend:

```bash
uv run uvicorn app.main:app --reload
```

Swagger API documentation:

```
http://localhost:8000/docs
```

---

# Daily Development Workflow

## Start Backend

```bash
cd backend

source .venv/bin/activate

uv run uvicorn app.main:app --reload
```

---

## Start Frontend

Open another terminal:

```bash
cd frontend

npm run dev
```

---

Open browser:

```
http://localhost:5173
```

---

# Stopping the Project

Frontend terminal:

```
Ctrl + C
```

Backend terminal:

```
Ctrl + C
```

No additional shutdown steps are required.

---

# Summary

| Component              | Technology     |
| ---------------------- | -------------- |
| Frontend               | React 19       |
| Language               | TypeScript     |
| Build Tool             | Vite           |
| Renderer               | PixiJS 8       |
| Shaders                | GLSL           |
| UI                     | Material UI    |
| State                  | Zustand        |
| API Cache              | TanStack Query |
| Graph Editor           | React Flow     |
| Code Editor            | Monaco Editor  |
| HTTP                   | Axios          |
| Backend                | FastAPI        |
| AI Workflow            | LangGraph      |
| LLM Integration        | LangChain      |
| ORM                    | SQLAlchemy     |
| Validation             | Pydantic       |
| Database               | SQLite         |
| Image Processing       | Pillow         |
| Video Export           | FFmpeg         |
| Python Package Manager | uv             |
| JS Package Manager     | npm            |
| Version Control        | Git            |
