const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.COG_SUPABASE_URL,
  process.env.COG_SUPABASE_SERVICE_ROLE_KEY
);

const FORBIDDEN_KEYS = ['user_id', 'session_id', 'email', 'name', 'blot_response', 'q1_answer', 'q2_answer', 'q3_answer'];

function hasIdentityMarkers(body) {
  return FORBIDDEN_KEYS.some(key => key in body);
}

function isValidProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const required = ['convergent', 'divergent', 'systems', 'pattern_first', 'adaptive', 'multi_domain_convergent'];
  const hasAll = required.every(k => typeof profile[k] === 'number');
  if (!hasAll) return false;
  const sum = required.reduce((acc, k) => acc + profile[k], 0);
  return Math.abs(sum - 1.0) < 0.05;
}

function isValidSyntaxMarkers(markers) {
  if (!markers || typeof markers !== 'object') return false;
  const required = ['caps_usage', 'compression_ratio', 'fragmentation_score', 'humor_present'];
  return required.every(k => k in markers);
}

function isValidConditionFlags(flags) {
  if (!flags || typeof flags !== 'object') return false;
  const required = ['energy_level', 'flatline', 'pre_breakthrough', 'stuck'];
  return required.every(k => k in flags);
}

function hashToken(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

app.get('/health', (req, res) => {
  res.json({ status: 'COGLife running', identity_layer: 'none' });
});

app.post('/api/ingest', async (req, res) => {
  const { session_token, cognitive_profile, syntax_markers, condition_flags, transmission_timestamp } = req.body;

  if (hasIdentityMarkers(req.body)) {
    return res.status(400).json({ error: 'Identity markers detected. Transmission rejected.' });
  }

  if (!session_token || typeof session_token !== 'string') {
    return res.status(400).json({ error: 'session_token required' });
  }

  if (!isValidProfile(cognitive_profile)) {
    return res.status(400).json({ error: 'cognitive_profile invalid or weights do not sum to 1' });
  }

  if (!isValidSyntaxMarkers(syntax_markers)) {
    return res.status(400).json({ error: 'syntax_markers incomplete' });
  }

  if (!isValidConditionFlags(condition_flags)) {
    return res.status(400).json({ error: 'condition_flags incomplete' });
  }

  try {
    const { data: existing } = await supabase
      .from('cog_snapshots')
      .select('id')
      .eq('session_token_hash', hashToken(session_token))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Duplicate transmission detected' });
    }

    const { error: snapshotError } = await supabase
      .from('cog_snapshots')
      .insert([{
        cognitive_profile,
        syntax_markers,
        condition_flags,
        transmission_timestamp: transmission_timestamp || new Date().toISOString()
      }]);

    if (snapshotError) throw snapshotError;

    const { error: logError } = await supabase
      .from('cog_transmission_log')
      .insert([{
        session_token_hash: hashToken(session_token),
        received_at: new Date().toISOString(),
        status: 'accepted'
      }]);

    if (logError) throw logError;

    res.json({ received: true });

  } catch (err) {
    console.error('COG ingest error:', err.message);
    res.status(500).json({ error: 'Ingest failed' });
  }
});

app.get('/api/aggregate', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cog_snapshots')
      .select('cognitive_profile, syntax_markers, condition_flags');

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json({ snapshot_count: 0, aggregate: null });
    }

    const profileKeys = ['convergent', 'divergent', 'systems', 'pattern_first', 'adaptive', 'multi_domain_convergent'];
    const aggregate_profile = {};

    profileKeys.forEach(key => {
      const avg = data.reduce((sum, row) => sum + (row.cognitive_profile?.[key] || 0), 0) / data.length;
      aggregate_profile[key] = parseFloat(avg.toFixed(4));
    });

    res.json({ snapshot_count: data.length, aggregate_profile });

  } catch (err) {
    console.error('COG aggregate error:', err.message);
    res.status(500).json({ error: 'Aggregate read failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`COGLife running on port ${PORT} — identity layer: none`);
});
