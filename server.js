const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Database setup =====
const db = new Database('greenwall.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    pm1       REAL, pm25 REAL, pm10 REAL,
    temperature REAL, humidity REAL,
    voc       REAL, nox REAL,
    flow      REAL, total_litres REAL,
    pump      INTEGER, fan INTEGER, lights INTEGER,
    state     TEXT, water TEXT, leak INTEGER
  )
`);

// Keep only 30 days of data
db.exec(`
  CREATE TRIGGER IF NOT EXISTS cleanup_old
  AFTER INSERT ON readings
  BEGIN
    DELETE FROM readings 
    WHERE timestamp < datetime('now', '-30 days');
  END
`);

// ===== Latest reading storage =====
let latest = {};

// ===== API Routes =====

// ESP32 posts data here
app.post('/api/data', (req, res) => {
  const d = req.body;
  latest = { ...d, timestamp: new Date().toISOString() };

  const insert = db.prepare(`
    INSERT INTO readings 
    (pm1, pm25, pm10, temperature, humidity, voc, nox, 
     flow, total_litres, pump, fan, lights, state, water, leak)
    VALUES 
    (@pm1, @pm25, @pm10, @temperature, @humidity, @voc, @nox,
     @flow, @total_litres, @pump, @fan, @lights, @state, @water, @leak)
  `);

  insert.run({
    pm1:          d.pm1          || 0,
    pm25:         d.pm25         || 0,
    pm10:         d.pm10         || 0,
    temperature:  d.temperature  || 0,
    humidity:     d.humidity     || 0,
    voc:          d.voc          || 0,
    nox:          d.nox          || 0,
    flow:         d.flow         || 0,
    total_litres: d.total_litres || 0,
    pump:         d.pump  ? 1 : 0,
    fan:          d.fan          || 0,
    lights:       d.lights       || 0,
    state:        d.state        || 'UNKNOWN',
    water:        d.water        || 'UNKNOWN',
    leak:         d.leak  ? 1 : 0
  });

  res.json({ ok: true });
});

// Get latest reading
app.get('/api/latest', (req, res) => {
  res.json(latest);
});

// Get historical data
app.get('/api/history', (req, res) => {
  const range = req.query.range || '24h';
  
  let interval;
  let groupBy;
  
  switch(range) {
    case '1h':
      interval = "'-1 hours'";
      groupBy  = "strftime('%Y-%m-%d %H:%M', timestamp)";
      break;
    case '24h':
      interval = "'-24 hours'";
      groupBy  = "strftime('%Y-%m-%d %H', timestamp)";
      break;
    case '7d':
      interval = "'-7 days'";
      groupBy  = "strftime('%Y-%m-%d %H', timestamp)";
      break;
    case '30d':
      interval = "'-30 days'";
      groupBy  = "strftime('%Y-%m-%d', timestamp)";
      break;
    default:
      interval = "'-24 hours'";
      groupBy  = "strftime('%Y-%m-%d %H', timestamp)";
  }

  const rows = db.prepare(`
    SELECT 
      ${groupBy} as time,
      AVG(pm25)       as pm25,
      AVG(pm1)        as pm1,
      AVG(pm10)       as pm10,
      AVG(temperature) as temperature,
      AVG(humidity)   as humidity,
      AVG(voc)        as voc,
      AVG(nox)        as nox,
      AVG(fan)        as fan
    FROM readings
    WHERE timestamp > datetime('now', ${interval})
    GROUP BY ${groupBy}
    ORDER BY time ASC
  `).all();

  res.json(rows);
});

// Control commands from dashboard
let commands = { pump: false, fan: -1, lights: -1, mode: 'auto' };

app.post('/api/control', (req, res) => {
  commands = { ...commands, ...req.body };
  res.json({ ok: true });
});

app.get('/api/control', (req, res) => {
  res.json(commands);
});

app.listen(PORT, () => {
  console.log(`Green Wall server running on port ${PORT}`);
});
