# AI Animated Slideshow Editor – Initial Setup Guide

## Technology Stack

### Frontend

* **React 19** – UI framework
* **TypeScript** – type-safe development
* **Vite** – frontend build tool and development server
* **PixiJS 8** – GPU-accelerated 2D rendering engine (installs with the Core Engine spec)
* **Zustand** – client state management
* **React Router** – application routing
* **Custom panel UI** – no component library (no MUI / React Flow / Monaco / TanStack Query / Axios)
* **Vitest + React Testing Library** – frontend testing
* **ESLint + Prettier** – linting and formatting
* **Husky + lint-staged** – git hooks

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

Install project libraries (bootstrap only — see Spec 01 — Foundation; PixiJS, SQLAlchemy, LangGraph/LangChain, Pillow arrive with their specs):

```bash
npm install \
react \
react-dom \
zustand \
react-router-dom
```

Install dev tooling:

```bash
npm install -D \
vite \
typescript \
eslint \
prettier \
vitest \
@testing-library/react \
husky \
lint-staged
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

Install backend dependencies (bootstrap only — see Spec 01 — Foundation):

```bash
uv add \
fastapi \
uvicorn \
pydantic
```

Other stack packages (SQLAlchemy, LangGraph, LangChain, python-multipart, Pillow) are added by their specs (Core Engine/Assets, AI, Asset Pipeline).

Run backend:

```bash
uv run uvicorn app.main:app --reload
```

Swagger API documentation:

```
http://localhost:8000/docs
```

---

## 5. Install FFmpeg

FFmpeg runs on the backend only (browser renders frames, backend encodes — see the Export spec).

macOS

```bash
brew install ffmpeg
```

Verify:

```bash
ffmpeg -version
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
| UI                     | Custom panel UI (no component library) |
| State                  | Zustand        |
| Routing                | React Router   |
| Frontend Testing       | Vitest + React Testing Library |
| Linting/Formatting     | ESLint + Prettier |
| Git Hooks              | Husky + lint-staged |
| Backend                | FastAPI        |
| AI Workflow            | LangGraph      |
| LLM Integration        | LangChain      |
| ORM                    | SQLAlchemy     |
| Validation             | Pydantic       |
| Database               | SQLite         |
| Image Processing       | Pillow         |
| Video Export           | FFmpeg (backend only) |
| Python Package Manager | uv             |
| JS Package Manager     | npm            |
| Version Control        | Git            |
