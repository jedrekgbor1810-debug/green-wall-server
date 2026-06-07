const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fetch   = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app  = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = 'https://ngjhmdzdetwqczaiwuam.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Latest reading in memory =====
let latest = {};
let commands = { pump: false, fan: -1, lights: -1, mode: 'auto' };

// ===== Helper =====
const sbHeaders = {
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type':  'application/json',
  'Prefer':        'return=minimal'
};

// ===== ESP32 posts data here =====
app.post('/api/data', async (req, res) => {
  const d = req.body;
  latest = { ...d, timestamp: new Date().toISOString() };

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/readings`, {
      method:  'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        pm1:          d.pm1          || 0,
        pm25:         d.pm25         || 0,
        pm10:         d.pm10         || 0,
        temperature:  d.temperature  || 0,
        humidity:     d.humidity     || 0,
        voc:          d.voc          || 0,
        nox:          d.nox          || 0,
        flow:         d.flow         || 0,
        total_litres: d.total_litres || 0,
        pump:         d.pump         || false,
        fan:          d.fan          || 0,
        lights:       d.lights       || 0,
        state:        d.state        || 'UNKNOWN',
        water:        d.water        || 'UNKNOWN',
        leak:         d.leak         || false
      })
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Supabase insert error:', err);
    res.status(500).json({ ok: false });
  }
});

// ===== Get latest reading =====
app.get('/api/latest', (req, res) => {
  res.json(latest);
});

// ===== Get historical data =====
app.get('/api/history', async (req, res) => {
  const range = req.query.range || '24h';

  let interval;
  switch(range) {
    case '1h':  interval = '1 hours';   break;
    case '24h': interval = '24 hours';  break;
    case '7d':  interval = '7 days';    break;
    case '30d': interval = '30 days';   break;
    case '3m':  interval = '90 days';   break;
    case '6m':  interval = '180 days';  break;
    case '1y':  interval = '365 days';  break;
    default:    interval = '24 hours';
  }

  try {
    const since = new Date(Date.now() - parseDuration(interval)).toISOString();
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/readings?timestamp=gte.${since}&order=timestamp.asc&select=timestamp,pm1,pm25,pm10,temperature,humidity,voc,nox,fan`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    
    const rows = await response.json();

    // Group and average data
    const grouped = {};
    rows.forEach(r => {
      const key = getGroupKey(r.timestamp, range);
      if (!grouped[key]) {
        grouped[key] = { time: key, pm1: [], pm25: [], pm10: [], temperature: [], humidity: [], voc: [], nox: [], fan: [] };
      }
      grouped[key].pm1.push(r.pm1);
      grouped[key].pm25.push(r.pm25);
      grouped[key].pm10.push(r.pm10);
      grouped[key].temperature.push(r.temperature);
      grouped[key].humidity.push(r.humidity);
      grouped[key].voc.push(r.voc);
      grouped[key].nox.push(r.nox);
      grouped[key].fan.push(r.fan);
    });

    const result = Object.values(grouped).map(g => ({
      time:        g.time,
      pm1:         avg(g.pm1),
      pm25:        avg(g.pm25),
      pm10:        avg(g.pm10),
      temperature: avg(g.temperature),
      humidity:    avg(g.humidity),
      voc:         avg(g.voc),
      nox:         avg(g.nox),
      fan:         avg(g.fan)
    }));

    res.json(result);
  } catch (err) {
    console.error('Supabase query error:', err);
    res.status(500).json([]);
  }
});

// ===== Controls =====
app.post('/api/control', (req, res) => {
  commands = { ...commands, ...req.body };
  res.json({ ok: true });
});

app.get('/api/control', (req, res) => {
  res.json(commands);
});

// ===== Helpers =====
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function parseDuration(str) {
  const [n, unit] = str.split(' ');
  const ms = { hours: 3600000, days: 86400000 };
  return parseInt(n) * (ms[unit] || 86400000);
}

function getGroupKey(timestamp, range) {
  const d = new Date(timestamp);
  switch(range) {
    case '1h':  return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    case '24h': return `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:00`;
    case '7d':  return `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:00`;
    case '30d': return `${d.getDate()}/${d.getMonth()+1}`;
    case '3m':  return `${d.getDate()}/${d.getMonth()+1}`;
    case '6m':  return `W${getWeek(d)} ${d.getFullYear()}`;
    case '1y':  return `${d.getMonth()+1}/${d.getFullYear()}`;
    default:    return `${d.getDate()}/${d.getMonth()+1}`;
  }
}

function getWeek(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
}

app.listen(PORT, () => {
  console.log(`Green Wall server running on port ${PORT}`);
});
