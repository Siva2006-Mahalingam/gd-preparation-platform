# Group Discussion (GD) Preparation Platform

An automated, real-time Group Discussion preparation and assessment platform designed for students preparing for campus placements and competitive interviews.

---

## Features

- **Real-Time Group Discussions:** Virtual GD rooms powered by Socket.IO with synchronized timers and turn-taking controls.
- **Dynamic Topic Generation:** Automated placement topic generation via Groq Cloud LLM (`openai/gpt-oss-120b`).
- **Live Speech-to-Text (STT):** In-browser real-time speech transcription using Web Speech API with visual speech feedback.
- **Multi-Dimensional AI Evaluation:** Detailed candidate assessment based on both spoken content and participation dynamics:
  - Content Quality (Arguments, reasoning, topic relevance)
  - Communication & Articulation
  - Participation & Engagement
  - Collaboration & Active Listening
  - Leadership & Initiative
- **Turn-by-Turn Spoken Review:** Candidate result page displays exact quotes and durations for each speaking turn.
- **Performance Analytics & History:** Tracks historical scores, improvement trends, and past session summaries.
- **Embedded Database:** Zero-configuration SQLite database with WAL mode for fast concurrent access.

---

## Tech Stack

- **Frontend:** Semantic HTML5, Vanilla CSS3 (Custom Design System), Modern JavaScript (ES6+), Web Speech API, MediaRecorder API
- **Backend:** Node.js, Express.js, Socket.IO
- **Database:** SQLite 3 (via `better-sqlite3`)
- **AI Services:** Groq Cloud API (`openai/gpt-oss-120b`, Whisper audio fallback)
- **Authentication:** JWT (JSON Web Tokens) & `bcryptjs`

---

## Getting Started

### Prerequisites

- **Node.js:** v18.0.0 or higher
- **npm:** v8.0.0 or higher

### Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repository-url>
   cd intern
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and provide your API keys:
   ```env
   TOPIC_API_URL=https://api.groq.com/openai/v1/chat/completions
   TOPIC_API_KEY=your_groq_api_key_here

   EVAL_API_URL=https://api.groq.com/openai/v1/chat/completions
   EVAL_API_KEY=your_groq_api_key_here

   JWT_SECRET=your_secret_key_here
   PORT=3000
   ```

4. **Start the application:**
   ```bash
   npm start
   ```

5. **Open in Browser:**
   Navigate to [http://localhost:3000](http://localhost:3000).

---

## Project Structure

```
├── public/                 # Static frontend client
│   ├── css/styles.css      # Core design system and styles
│   ├── js/                 # Client controllers (auth, dashboard, gd, result, etc.)
│   ├── index.html          # Authentication / landing page
│   ├── dashboard.html      # User dashboard & session actions
│   ├── room.html           # Live GD room interface
│   ├── result.html         # Evaluation & transcript report
│   ├── sessions.html       # Session history
│   ├── performance.html    # Analytics dashboard
│   └── public-rooms.html   # Public rooms list
├── server/                 # Express & Socket.IO backend
│   ├── middleware/         # Auth verification
│   ├── routes/             # REST route handlers
│   ├── services/           # AI topic & evaluation services
│   ├── socket/             # WebSocket handlers & room state
│   ├── config.js           # Environment loader & config
│   ├── db.js               # SQLite schema & migrations
│   └── index.js            # Server entrypoint
├── .env.example            # Environment template (safe for version control)
├── .gitignore              # Ignored files (.env, node_modules, db, uploads)
├── package.json            # Project dependencies & scripts
└── README.md               # Project documentation
```

---

## License

This project is licensed under the ISC License.
