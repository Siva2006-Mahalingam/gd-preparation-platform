const config = require('../config');

// Fallback topics used when TOPIC_API_URL is not configured
const FALLBACK_TOPICS = [
  'Should artificial intelligence replace human jobs?',
  'Is social media doing more harm than good to society?',
  'Should college education be free for everyone?',
  'Is remote work better than working from an office?',
  'Should voting be made mandatory in a democracy?',
  'Are electric vehicles the future of transportation?',
  'Should there be a universal basic income?',
  'Is censorship ever justified in a free society?',
  'Should students be allowed to grade their teachers?',
  'Is technology making us more isolated?',
  'Should plastic be completely banned?',
  'Is competition better than collaboration for growth?',
  'Should healthcare be a fundamental right?',
  'Are standardized tests an accurate measure of intelligence?',
  'Should the legal voting age be lowered to 16?',
  'Is globalization beneficial for developing countries?',
  'Should governments regulate cryptocurrency?',
  'Is space exploration worth the cost?',
  'Should animals be used for scientific research?',
  'Is the gig economy good for workers?',
  'Should junk food advertising be banned for children?',
  'Is nuclear energy the solution to climate change?',
  'Should there be limits on free speech?',
  'Is a four-day work week more productive?',
  'Should coding be a mandatory subject in schools?',
];

let usedTopicIndices = new Set();

/**
 * Fetch a GD topic from the configured API or use fallback.
 * Returns a plain topic string — no difficulty, category, or description.
 */
async function fetchTopic() {
  // Try external API first
  if (config.TOPIC_API_URL) {
    try {
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
              content: 'Generate a single group discussion topic suitable for students preparing for placements. Return only the topic as a plain string. No difficulty level, no category, no description — just the topic.'
            }
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }

      const data = await response.json();

      // Try common response formats
      const topic = data.topic
        || data.text
        || data.content
        || (data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text))
        || (data.candidates && data.candidates[0] && data.candidates[0].content?.parts?.[0]?.text)
        || null;

      if (topic && typeof topic === 'string') {
        return topic.trim().replace(/^["']|["']$/g, '');
      }

      console.warn('⚠️  Could not parse topic from API response. Using fallback.');
    } catch (err) {
      console.warn('⚠️  Topic API call failed:', err.message, '— Using fallback.');
    }
  }

  // Fallback: pick from built-in list
  if (usedTopicIndices.size >= FALLBACK_TOPICS.length) {
    usedTopicIndices.clear();
  }

  let index;
  do {
    index = Math.floor(Math.random() * FALLBACK_TOPICS.length);
  } while (usedTopicIndices.has(index));

  usedTopicIndices.add(index);
  return FALLBACK_TOPICS[index];
}

module.exports = { fetchTopic };
