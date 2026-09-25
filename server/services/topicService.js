const config = require('../config');
const { db } = require('../db');

// ════════════════════════════════════════════════════════════
// DIVERSE REAL-WORLD GD TOPIC CATEGORIES & CURATED REPOSITORY
// Strictly stops AI-only repetition. Technology capped < 6%.
// ════════════════════════════════════════════════════════════

const CATEGORIES = [
  {
    id: 'education',
    name: 'Education & Academics',
    description: 'Practical skills, curriculum reform, assessment models, accessibility, and modern pedagogy',
    weight: 12,
    topics: [
      'Should college education focus more on practical skills than examinations?',
      'Can online degrees and remote credentials match the value of campus learning?',
      'Should standardized entrance examinations be replaced with holistic portfolio assessments?',
      'Should curriculum design be updated annually in collaboration with industry employers?',
      'Should higher education be completely subsidized by governments for all eligible students?',
      'Is peer-to-peer collaborative learning more effective than traditional lecture-based teaching?',
      'Should universities make interdisciplinary studies mandatory across all degree programs?',
      'Are letter grades an effective motivator or a barrier to genuine intellectual curiosity?',
    ],
  },
  {
    id: 'economy',
    name: 'Economy & Business',
    description: 'Banking, fintech, inequality, startups, consumer habits, and financial policy',
    weight: 12,
    topics: [
      'Is a cashless economy practical, resilient, and inclusive for everyone?',
      'Should governments implement a universal basic income to combat poverty?',
      'Are early-stage startups or established corporations better for young graduates?',
      'Is the gig economy empowering independent workers or creating financial insecurity?',
      'Can economic growth and reduction of income inequality happen simultaneously?',
      'Should small local businesses receive higher tax protections against multinational retail?',
      'Is excessive consumer credit culture harming young professionals financial stability?',
      'Should essential public utilities like water and electricity remain strictly state-owned?',
    ],
  },
  {
    id: 'employment',
    name: 'Employment & Careers',
    description: 'Workplace culture, recruitment criteria, work-life balance, and career development',
    weight: 12,
    topics: [
      'Is work experience more valuable than academic performance when starting a career?',
      'Is a four-day work week viable and beneficial for employee productivity and wellbeing?',
      'Does remote work promote better work-life balance or lead to professional burnout?',
      'Is frequent job switching beneficial for career acceleration or does it signal instability?',
      'Should emotional intelligence and interpersonal skills be prioritized as heavily as technical ability in hiring?',
      'Should companies replace rigid 9-to-5 schedules with purely output-based evaluation?',
      'Should organizations mandate equal parental leave for both mothers and fathers?',
      'Are non-compete clauses in employment contracts ethical in modern knowledge economies?',
    ],
  },
  {
    id: 'environment',
    name: 'Environment & Sustainability',
    description: 'Climate action, renewable transition, urban design, conservation, and resource policy',
    weight: 12,
    topics: [
      'Can economic development and environmental protection progress together sustainably?',
      'Should single-use plastics be banned worldwide with strict legal penalties?',
      'Is nuclear energy the most practical transition fuel for addressing climate change?',
      'Are individual sustainable choices enough to counter industrial carbon emissions?',
      'Should cities prioritize public transit infrastructure over electric private vehicle subsidies?',
      'Can renewable energy reliably replace fossil fuels within the next decade?',
      'Should corporations be legally forced to pay environmental reparations for pollution?',
      'Is ecotourism genuinely beneficial for conservation or does it disrupt delicate ecosystems?',
    ],
  },
  {
    id: 'society',
    name: 'Social Issues & Governance',
    description: 'Community life, civic rights, urbanization, equity, and social change',
    weight: 12,
    topics: [
      'Has social media improved communication or reduced meaningful human interaction?',
      'Should the legal voting age be lowered to 16 in modern democracies?',
      'Does rapid urbanization erode community bonding and traditional support systems?',
      'Should public surveillance in metropolitan cities be expanded to ensure safety?',
      'Can social media activism create meaningful real-world legislative reform?',
      'Should mandatory community service be a prerequisite for university graduation?',
      'Is censorship in digital streaming platforms justified to protect cultural harmony?',
      'Are smart cities creating socio-economic divides between tech-savvy and vulnerable citizens?',
    ],
  },
  {
    id: 'healthcare',
    name: 'Healthcare & Well-being',
    description: 'Preventive medicine, mental health, public health policy, and lifestyle habits',
    weight: 10,
    topics: [
      'Should preventive healthcare receive greater attention and investment than clinical treatment?',
      'Should mental health days be formally mandated by labor laws for all organizations?',
      'Should junk food advertising targeted at young audiences be legally banned?',
      'Is universal healthcare achievable without compromising the quality of medical services?',
      'Should physical fitness and nutrition be evaluated as academic criteria in schools?',
      'Should healthcare workers and physicians be legally prohibited from going on strike?',
      'Are digital health apps improving patient autonomy or causing health anxiety?',
    ],
  },
  {
    id: 'ethics',
    name: 'Ethics & Corporate Responsibility',
    description: 'Business integrity, consumer rights, animal welfare, and moral governance',
    weight: 10,
    topics: [
      'Should companies prioritize ethical practices even when they significantly increase operational costs?',
      'Should whistleblowers be granted absolute legal immunity when exposing corporate misconduct?',
      'Should cosmetic and chemical testing on animals be globally prohibited?',
      'Is aggressive targeted advertising to consumers morally justifiable in competitive markets?',
      'Should executives be held personally and criminally liable for corporate environmental damage?',
      'Should patent protections on life-saving pharmaceuticals be relaxed during global health crises?',
    ],
  },
  {
    id: 'sports_media',
    name: 'Sports, Media & Culture',
    description: 'Athletic culture, journalism, entertainment, and cultural heritage',
    weight: 8,
    topics: [
      'Should professional sports and athletic development receive more attention in formal education?',
      'Has the commercialization of sports overshadowed sportsmanship and athletic spirit?',
      'Should esports be officially recognized and funded on equal footing with physical sports?',
      'Does cultural globalization enrich local traditions or erode regional heritage?',
      'Should public funding support the preservation of arts and monuments during economic downturns?',
      'Has 24-hour news media prioritized sensationalism over objective journalism?',
    ],
  },
  {
    id: 'abstract',
    name: 'Abstract & Philosophical Themes',
    description: 'Lateral thinking, leadership philosophy, character, and worldview',
    weight: 7,
    topics: [
      'Success is a journey, not a destination.',
      'Failure is a stepping stone or a stumbling block: it depends on human perception.',
      'Does true freedom exist without disciplined boundaries and social rules?',
      'Is patience a virtue or an obstacle in the fast-paced modern world?',
      'Innovation begins where conventional wisdom and traditional comfort end.',
      'Knowledge without practical wisdom is like a ship without a rudder.',
      'Is conformity necessary for societal order or the enemy of creative progress?',
    ],
  },
  {
    id: 'technology',
    name: 'Technology & Digital Life (Controlled)',
    description: 'General technology impact on productivity, security, and everyday life (strictly non-repetitive)',
    weight: 5, // Capped low so AI/Tech is only an occasional topic
    topics: [
      'Has technology made people more productive or more dependent in everyday life?',
      'Is the rapid decline of physical cash compromising personal financial privacy?',
      'Are smart home devices genuinely enhancing security or creating surveillance risks?',
      'Should coding and digital literacy be taught alongside reading and mathematics in primary school?',
    ],
  },
];

// Rolling in-memory history of last used category IDs to prevent consecutive repeats
const recentCategoryHistory = [];

// ════════════════════════════════════════════════════════════
// CANONICAL THEME EXTRACTION & DUPLICATE DETECTION
// ════════════════════════════════════════════════════════════

// Synonym groups mapped to canonical semantic tokens
const THEME_GROUPS = [
  {
    token: '__AI_AUTOMATION__',
    patterns: [/\bai\b/i, /artificial intelligence/i, /chatgpt/i, /automation/i, /robots?\b/i, /machine learning/i, /llm/i],
  },
  {
    token: '__JOBS_EMPLOYMENT__',
    patterns: [/\bjobs?\b/i, /\bwork\b/i, /workers?\b/i, /employees?\b/i, /employment/i, /unemployment/i, /careers?\b/i],
  },
  {
    token: '__REPLACEMENT__',
    patterns: [/replace/i, /substitute/i, /displace/i, /take away/i, /eliminate/i, /threaten/i],
  },
  {
    token: '__EDUCATION_COLLEGE__',
    patterns: [/college/i, /university/i, /school/i, /academics?/i, /curriculum/i, /degrees?\b/i, /students?\b/i],
  },
  {
    token: '__ENVIRONMENT_CLIMATE__',
    patterns: [/environment/i, /climate/i, /sustainable/i, /pollution/i, /carbon/i, /plastic/i, /green/i, /renewable/i],
  },
  {
    token: '__ECONOMY_FINANCE__',
    patterns: [/economy/i, /economic/i, /cashless/i, /money/i, /income/i, /financial/i, /poverty/i, /credit/i],
  },
  {
    token: '__SOCIAL_MEDIA__',
    patterns: [/social media/i, /networking apps/i, /facebook/i, /instagram/i, /screen time/i, /influencers?/i],
  },
  {
    token: '__HEALTH_WELLNESS__',
    patterns: [/healthcare/i, /health/i, /medical/i, /preventive/i, /nutrition/i, /mental health/i, /wellness/i],
  },
  {
    token: '__REMOTE_WORK__',
    patterns: [/remote work/i, /work from home/i, /wfh/i, /office work/i, /hybrid work/i],
  },
  {
    token: '__FOUR_DAY_WEEK__',
    patterns: [/four[- ]day work week/i, /4[- ]day week/i, /shorter work week/i],
  },
  {
    token: '__SPORTS_ATHLETICS__',
    patterns: [/sports?\b/i, /athletics?\b/i, /esports?\b/i, /athletes?\b/i, /games?\b/i],
  },
  {
    token: '__ETHICS_CORPORATE__',
    patterns: [/ethics?\b/i, /ethical/i, /whistleblowers?/i, /corporate responsibility/i, /animal testing/i],
  },
];

const STOP_WORDS = new Set([
  'should', 'will', 'can', 'could', 'would', 'is', 'are', 'was', 'were', 'the', 'a', 'an',
  'and', 'or', 'for', 'in', 'on', 'at', 'to', 'of', 'with', 'by', 'from', 'about', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below', 'under', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'than', 'more', 'less', 'better', 'worse',
  'human', 'people', 'society', 'everyone', 'anyone', 'their', 'our', 'what', 'which', 'who',
  'why', 'how', 'when', 'where', 'there', 'it', 'its', 'they', 'them', 'we', 'us', 'you', 'your'
]);

/**
 * Extract canonical semantic tokens and normalized keywords from a topic.
 */
function analyzeTopicSemantics(topicStr) {
  if (!topicStr || typeof topicStr !== 'string') {
    return { canonicalTokens: new Set(), keywords: new Set(), rawNormalized: '' };
  }

  const rawNormalized = topicStr.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const canonicalTokens = new Set();

  for (const group of THEME_GROUPS) {
    for (const pattern of group.patterns) {
      if (pattern.test(topicStr)) {
        canonicalTokens.add(group.token);
        break;
      }
    }
  }

  const words = rawNormalized.split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const keywords = new Set(words);

  return { canonicalTokens, keywords, rawNormalized };
}

/**
 * Compare two topics to detect if they are the exact same or substantially identical in theme.
 * Rejects variations like "Should AI replace human jobs?" vs "Will artificial intelligence take away jobs?".
 */
function areTopicsSubstantiallySimilar(topicA, topicB) {
  if (!topicA || !topicB) return false;

  const a = analyzeTopicSemantics(topicA);
  const b = analyzeTopicSemantics(topicB);

  // Exact normalized match
  if (a.rawNormalized === b.rawNormalized) return true;

  // Canonical token overlap (e.g. both contain __AI_AUTOMATION__ AND __JOBS_EMPLOYMENT__)
  let sharedCanonical = 0;
  for (const token of a.canonicalTokens) {
    if (b.canonicalTokens.has(token)) sharedCanonical++;
  }

  // If two topics share 2 or more specialized theme concepts (e.g. AI + Jobs, Remote Work + Productivity)
  if (sharedCanonical >= 2) {
    return true;
  }

  // Keyword Jaccard similarity
  if (a.keywords.size > 0 && b.keywords.size > 0) {
    let intersection = 0;
    for (const kw of a.keywords) {
      if (b.keywords.has(kw)) intersection++;
    }
    const union = new Set([...a.keywords, ...b.keywords]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard >= 0.45) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a candidate topic is a duplicate or too similar to any previously used topic in history.
 */
function isTopicRepeatedInHistory(candidateTopic, previousTopicsList = []) {
  if (!candidateTopic || !Array.isArray(previousTopicsList)) return false;

  for (const prev of previousTopicsList) {
    if (typeof prev === 'string' && areTopicsSubstantiallySimilar(candidateTopic, prev)) {
      return true;
    }
  }
  return false;
}

// ════════════════════════════════════════════════════════════
// CATEGORY BALANCING
// Ensures consecutive sessions do NOT repeatedly use the same domain.
// ════════════════════════════════════════════════════════════

/**
 * Select a balanced category avoiding recently used categories.
 */
function selectBalancedCategory(recentlyUsedCategoryIds = []) {
  const recentSet = new Set(recentlyUsedCategoryIds.slice(-3));

  // Filter categories that haven't been used in the last 3 sessions
  let candidates = CATEGORIES.filter(c => !recentSet.has(c.id));

  // If all categories were somehow recent, avoid at least the very last one
  if (candidates.length === 0) {
    const lastId = recentlyUsedCategoryIds[recentlyUsedCategoryIds.length - 1];
    candidates = CATEGORIES.filter(c => c.id !== lastId);
  }

  // Weight-based random selection
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let randomVal = Math.random() * totalWeight;

  for (const cat of candidates) {
    randomVal -= cat.weight;
    if (randomVal <= 0) {
      return cat;
    }
  }

  return candidates[0] || CATEGORIES[0];
}

/**
 * Retrieve previous topics from database for a specific user to prevent repeats.
 */
async function getPreviousUserTopics(userId) {
  const previousTopics = [];
  if (!userId) return previousTopics;

  try {
    // 1. Topics from sessions the user participated in
    const sessionTopics = await db.prepare(`
      SELECT DISTINCT s.topic
      FROM sessions s
      JOIN room_participants rp ON rp.room_id = s.room_id
      WHERE rp.user_id = ? AND s.topic IS NOT NULL
      ORDER BY s.started_at DESC LIMIT 40
    `).all(userId);

    for (const r of sessionTopics || []) {
      if (r.topic && r.topic.trim()) previousTopics.push(r.topic.trim());
    }

    // 2. Topics from rooms hosted or joined by user
    const roomTopics = await db.prepare(`
      SELECT DISTINCT r.topic
      FROM rooms r
      WHERE (r.host_id = ? OR r.id IN (SELECT room_id FROM room_participants WHERE user_id = ?))
      AND r.topic IS NOT NULL
      ORDER BY r.created_at DESC LIMIT 40
    `).all(userId, userId);

    for (const r of roomTopics || []) {
      if (r.topic && r.topic.trim() && !previousTopics.includes(r.topic.trim())) {
        previousTopics.push(r.topic.trim());
      }
    }
  } catch (err) {
    console.warn('Note: Could not query previous topics from DB:', err.message);
  }

  return previousTopics;
}

// ════════════════════════════════════════════════════════════
// MAIN TOPIC FETCHING ENGINE
// ════════════════════════════════════════════════════════════

/**
 * Fetch a GD topic with guaranteed variety, category balancing, and duplicate prevention.
 * @param {Object} options
 * @param {number|string} [options.userId] - The user requesting the topic (for history tracking)
 * @param {Array<string>} [options.excludeTopics] - Explicit list of topics to avoid
 * @returns {Promise<string>} Plain topic string
 */
async function fetchTopic(options = {}) {
  const userId = options.userId || null;
  const explicitExcludes = Array.isArray(options.excludeTopics) ? options.excludeTopics : [];

  // 1. Gather all previously used topics
  const previousTopics = await getPreviousUserTopics(userId);
  for (const ex of explicitExcludes) {
    if (ex && typeof ex === 'string') previousTopics.push(ex.trim());
  }

  // 2. Determine last category used in history
  const targetCategory = selectBalancedCategory(recentCategoryHistory);
  recentCategoryHistory.push(targetCategory.id);
  if (recentCategoryHistory.length > 10) recentCategoryHistory.shift();

  console.log(`🎯 Generating GD topic in category: [${targetCategory.name}] (Recent categories: ${recentCategoryHistory.slice(-4).join(', ')})`);

  // 3. Try external LLM API with strict category & negative constraints
  if (config.TOPIC_API_URL) {
    try {
      const prompt = `You are an expert evaluator designing Group Discussion (GD) topics for college placement interviews.
Generate a single, thought-provoking group discussion topic suitable for college students.

Target Category: ${targetCategory.name}
Category Scope: ${targetCategory.description}

STRICT CONSTRAINTS:
1. Do NOT generate topics about Artificial Intelligence, ChatGPT, AI bots, or Automation.
2. The topic must belong directly to the "${targetCategory.name}" category.
3. It must be open-ended, allowing opposing viewpoints and multi-faceted discussion.
4. Avoid overly specialized or technical jargon.
5. STRICTLY DO NOT repeat or rephrase any of the following previously used topics:
${previousTopics.slice(0, 15).map(t => `- "${t}"`).join('\n') || '- None'}

Return ONLY the single discussion topic as a plain sentence or question. No quotes, no category prefix, no preamble.`;

      const response = await fetch(config.TOPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.TOPIC_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [
            {
              role: 'user',
              content: prompt,
            }
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        let topicCandidate = data.topic
          || data.text
          || data.content
          || (data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text))
          || (data.candidates && data.candidates[0] && data.candidates[0].content?.parts?.[0]?.text)
          || null;

        if (topicCandidate && typeof topicCandidate === 'string') {
          topicCandidate = topicCandidate.trim().replace(/^["']|["']$/g, '').replace(/^(Topic|Question):\s*/i, '');

          // Check for AI-leakage or duplicate against history
          const isAILeak = targetCategory.id !== 'technology' && /\b(ai|artificial intelligence|chatgpt)\b/i.test(topicCandidate);
          const isDuplicate = isTopicRepeatedInHistory(topicCandidate, previousTopics);

          if (!isAILeak && !isDuplicate && topicCandidate.length > 15) {
            console.log(`✅ Accepted API Topic (${targetCategory.name}): "${topicCandidate}"`);
            return topicCandidate;
          } else {
            console.warn(`⚠️ API topic rejected (AI leak: ${isAILeak}, Duplicate: ${isDuplicate}): "${topicCandidate}". Switching to curated bank.`);
          }
        }
      }
    } catch (apiErr) {
      console.warn('⚠️ Topic API call failed:', apiErr.message, '— Using curated category repository.');
    }
  }

  // 4. Select from Curated Category Repository (Guaranteed high-quality & non-repeating)
  // First attempt: search inside the chosen targetCategory
  let pool = targetCategory.topics.filter(t => !isTopicRepeatedInHistory(t, previousTopics));

  // If all topics in this category were used, search in other non-recent categories
  if (pool.length === 0) {
    for (const cat of CATEGORIES) {
      if (cat.id !== targetCategory.id && cat.id !== 'technology') {
        const catPool = cat.topics.filter(t => !isTopicRepeatedInHistory(t, previousTopics));
        if (catPool.length > 0) {
          pool = catPool;
          break;
        }
      }
    }
  }

  // Absolute fallback: pick any topic that has the least similarity
  if (pool.length === 0) {
    pool = targetCategory.topics;
  }

  const selected = pool[Math.floor(Math.random() * pool.length)];
  console.log(`✨ Selected verified unique topic: "${selected}"`);
  return selected;
}

module.exports = {
  fetchTopic,
  areTopicsSubstantiallySimilar,
  isTopicRepeatedInHistory,
  CATEGORIES,
};
