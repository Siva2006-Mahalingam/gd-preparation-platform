const config = require('../config');

/**
 * Evaluate an individual student's GD performance.
 * Uses the configured EVAL_API if available, otherwise generates
 * a metrics-based heuristic evaluation.
 *
 * @param {Object} participantData
 * @param {string} participantData.username
 * @param {string} participantData.topic
 * @param {number} participantData.totalParticipants
 * @param {number} participantData.contributionCount
 * @param {number} participantData.totalSpeakingTime - seconds
 * @param {number} participantData.discussionDuration - seconds
 * @param {number[]} participantData.contributionDurations - array of seconds
 * @param {number[]} participantData.contributionTimestamps - array of relative start times
 */
async function evaluateParticipant(participantData) {
  // Try external API first
  if (config.EVAL_API_URL) {
    try {
      const prompt = buildEvalPrompt(participantData);

      const response = await fetch(config.EVAL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.EVAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        throw new Error(`Eval API returned status ${response.status}`);
      }

      const data = await response.json();

      // Try to extract JSON from response
      let evalText = data.text
        || data.content
        || (data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text))
        || (data.candidates && data.candidates[0] && data.candidates[0].content?.parts?.[0]?.text)
        || null;

      if (evalText) {
        // Extract JSON from potential markdown code blocks
        const jsonMatch = evalText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, evalText];
        const parsed = JSON.parse(jsonMatch[1].trim());
        return normalizeEvaluation(parsed);
      }

      console.warn('⚠️  Could not parse evaluation from API. Using metrics-based evaluation.');
    } catch (err) {
      console.warn('⚠️  Evaluation API call failed:', err.message, '— Using metrics-based evaluation.');
    }
  }

  // Fallback: metrics-based heuristic evaluation
  return generateMetricsEvaluation(participantData);
}

function buildEvalPrompt(data) {
  const contributionsList = (data.contributions && data.contributions.length > 0)
    ? data.contributions.map((c, i) => {
        const text = c.transcript && c.transcript.trim().length > 0
          ? `"${c.transcript.trim()}"`
          : '[Spoke without recorded speech / silent turn]';
        return `Turn ${c.order || (i + 1)} (${(c.duration || 0).toFixed(1)}s):\n${text}`;
      }).join('\n\n')
    : '[Candidate did not make any spoken contributions]';

  return `You are an expert evaluator and assessor for student Group Discussions (GD).
Assess the following student's individual performance fairly, constructively, and realistically.

Discussion Topic: "${data.topic}"
Student Name: ${data.username}
Total Participants: ${data.totalParticipants}

Student's Spoken Contributions (Transcripts of what the student said):
${contributionsList}

Participation Metrics:
- Number of contributions: ${data.contributionCount}
- Total speaking time: ${data.totalSpeakingTime.toFixed(1)} seconds
- Total discussion duration: ${data.discussionDuration.toFixed(1)} seconds
- Speaking time percentage: ${((data.totalSpeakingTime / Math.max(data.discussionDuration, 1)) * 100).toFixed(1)}%
- Contribution durations (seconds): [${(data.contributionDurations || []).map(d => d.toFixed(1)).join(', ')}]
- Contribution timing (seconds from start): [${(data.contributionTimestamps || []).map(t => t.toFixed(1)).join(', ')}]

Evaluation Dimensions:
1. Content Quality: Evaluate the actual spoken content against the topic "${data.topic}". Did they present insightful points, logical arguments, real-world examples, or structured reasoning?
2. Communication: Articulation, vocabulary, fluency, clarity, sentence structure, and tone.
3. Participation: Active engagement, frequency of contributions, and balanced speaking time.
4. Collaboration: Constructive tone, acknowledging the group dynamic, synthesizing or building on ideas.
5. Leadership: Initiative (speaking early), guiding discussion focus, introducing fresh perspectives, or summarizing.

Return a valid JSON object with exactly these fields:
{
  "overall_score": <number 0-100, weighted composite>,
  "communication_score": <number 0-100>,
  "content_score": <number 0-100>,
  "participation_score": <number 0-100>,
  "collaboration_score": <number 0-100>,
  "leadership_score": <number 0-100>,
  "strengths": [<2-4 specific strengths, referencing what was said if applicable>],
  "improvements": [<2-4 specific, actionable improvement points>],
  "feedback": "<detailed, personalized constructive paragraph addressed to the student by name>"
}

Return ONLY the JSON object, no other text.`;
}

function normalizeEvaluation(parsed) {
  return {
    overall_score: clamp(parsed.overall_score || 0, 0, 100),
    communication_score: clamp(parsed.communication_score || 0, 0, 100),
    content_score: clamp(parsed.content_score || 0, 0, 100),
    participation_score: clamp(parsed.participation_score || 0, 0, 100),
    collaboration_score: clamp(parsed.collaboration_score || 0, 0, 100),
    leadership_score: clamp(parsed.leadership_score || 0, 0, 100),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    feedback: parsed.feedback || '',
  };
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, Number(val) || 0));
}

/**
 * Generate evaluation based purely on participation metrics.
 * Used when no external eval API is configured.
 */
function generateMetricsEvaluation(data) {
  const {
    contributionCount,
    totalSpeakingTime,
    discussionDuration,
    contributionDurations,
    contributionTimestamps,
    totalParticipants,
    username,
  } = data;

  const speakingPct = (totalSpeakingTime / Math.max(discussionDuration, 1)) * 100;
  const idealPct = 100 / Math.max(totalParticipants, 1);
  const hasContributions = contributionCount > 0;

  // ── Participation Score ──
  let participationScore = 0;
  if (hasContributions) {
    // Ideal: proportional share of speaking time
    const pctRatio = Math.min(speakingPct / idealPct, 2);
    participationScore = Math.min(100, pctRatio * 50);

    // Bonus for multiple contributions
    if (contributionCount >= 2) participationScore += 15;
    if (contributionCount >= 4) participationScore += 10;

    // Bonus for speaking early
    if (contributionTimestamps.length > 0 && contributionTimestamps[0] < discussionDuration * 0.25) {
      participationScore += 10;
    }

    participationScore = clamp(participationScore, 0, 100);
  }

  // ── Communication Score ──
  let communicationScore = 0;
  if (hasContributions) {
    // Based on avg contribution length (ideal: 15-45 seconds)
    const avgDuration = totalSpeakingTime / contributionCount;
    if (avgDuration >= 10 && avgDuration <= 60) {
      communicationScore = 70 + Math.min(30, (Math.min(avgDuration, 45) / 45) * 30);
    } else if (avgDuration < 10) {
      communicationScore = 40 + (avgDuration / 10) * 30;
    } else {
      communicationScore = Math.max(30, 70 - ((avgDuration - 60) / 30) * 20);
    }
    communicationScore = clamp(communicationScore, 0, 100);
  }

  // ── Content Score ──
  let contentScore = 0;
  if (hasContributions) {
    // Heuristic: more and varied-length contributions suggest better content
    const durationVariance = contributionDurations.length > 1
      ? standardDeviation(contributionDurations)
      : 0;

    contentScore = Math.min(100,
      30 + (contributionCount * 10) + (durationVariance > 5 ? 15 : 0) + (speakingPct > 5 ? 20 : 0)
    );
    contentScore = clamp(contentScore, 0, 100);
  }

  // ── Collaboration Score ──
  let collaborationScore = 0;
  if (hasContributions) {
    // Not dominating (not too much speaking time)
    if (speakingPct <= idealPct * 1.5) {
      collaborationScore = 75;
    } else if (speakingPct <= idealPct * 2) {
      collaborationScore = 60;
    } else {
      collaborationScore = 40;
    }

    // Multiple spaced contributions suggest back-and-forth
    if (contributionTimestamps.length >= 2) {
      const gaps = [];
      for (let i = 1; i < contributionTimestamps.length; i++) {
        gaps.push(contributionTimestamps[i] - contributionTimestamps[i - 1]);
      }
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (avgGap > 20) collaborationScore += 15;
    }

    collaborationScore = clamp(collaborationScore, 0, 100);
  }

  // ── Leadership Score ──
  let leadershipScore = 0;
  if (hasContributions) {
    // Speaking early shows initiative
    if (contributionTimestamps[0] < discussionDuration * 0.15) {
      leadershipScore += 40;
    } else if (contributionTimestamps[0] < discussionDuration * 0.3) {
      leadershipScore += 25;
    }

    // Contributing throughout the discussion
    if (contributionTimestamps.length > 0) {
      const lastContrib = contributionTimestamps[contributionTimestamps.length - 1];
      if (lastContrib > discussionDuration * 0.7) {
        leadershipScore += 25;
      }
    }

    // Multiple contributions show sustained engagement
    if (contributionCount >= 3) leadershipScore += 20;
    if (contributionCount >= 2) leadershipScore += 15;

    leadershipScore = clamp(leadershipScore, 0, 100);
  }

  // ── Overall Score ──
  const overallScore = Math.round(
    participationScore * 0.25 +
    communicationScore * 0.20 +
    contentScore * 0.20 +
    collaborationScore * 0.20 +
    leadershipScore * 0.15
  );

  // ── Strengths & Improvements ──
  const strengths = [];
  const improvements = [];

  if (participationScore >= 70) strengths.push('Active participation throughout the discussion');
  else if (participationScore < 40) improvements.push('Increase participation frequency — try to contribute more often');

  if (communicationScore >= 70) strengths.push('Good contribution length — clear and structured speaking');
  else if (communicationScore < 40) improvements.push('Work on structuring your responses — aim for 15-45 second contributions');

  if (contentScore >= 70) strengths.push('Varied contributions showing depth of thought');
  else if (contentScore < 40) improvements.push('Try to add more substance and variety to your points');

  if (collaborationScore >= 70) strengths.push('Collaborative approach — balanced speaking time');
  else if (collaborationScore < 40) improvements.push('Be mindful of speaking time — allow others to contribute equally');

  if (leadershipScore >= 60) strengths.push('Initiative shown by speaking early and staying engaged');
  else if (leadershipScore < 30) improvements.push('Take initiative — try to speak earlier in the discussion');

  if (contributionCount >= 3) strengths.push(`Made ${contributionCount} contributions showing sustained engagement`);
  if (contributionCount === 1) improvements.push('Try to contribute more than once to show sustained engagement');
  if (contributionCount === 0) {
    improvements.push('You did not contribute to the discussion — practice speaking up');
    improvements.push('Even a single contribution would significantly improve your scores');
  }

  if (strengths.length === 0) strengths.push('Participated in the group discussion session');

  // ── Feedback ──
  let feedback = '';
  if (!hasContributions) {
    feedback = `${username}, you did not make any verbal contributions during this group discussion. Active participation is essential for GD performance. In your next session, try to speak up early — even a brief point shows initiative. Start by building on what others say, and gradually share your own perspectives. Remember, the goal is to engage, not to be perfect.`;
  } else if (overallScore >= 75) {
    feedback = `Excellent performance, ${username}! You made ${contributionCount} contributions totaling ${totalSpeakingTime.toFixed(0)} seconds of speaking time (${speakingPct.toFixed(1)}% of the discussion). Your participation was well-balanced and showed strong engagement. Continue refining your points for even more impact.`;
  } else if (overallScore >= 50) {
    feedback = `Good effort, ${username}. You contributed ${contributionCount} time(s) with ${totalSpeakingTime.toFixed(0)} seconds of total speaking time. To improve further, focus on distributing your contributions more evenly throughout the discussion and aim for clear, structured points of 15-45 seconds each.`;
  } else {
    feedback = `${username}, you made ${contributionCount} contribution(s) but there is room for significant improvement. Try to engage more actively, speak earlier in the discussion, and aim for multiple well-spaced contributions. Practice structuring your thoughts before speaking.`;
  }

  return {
    overall_score: overallScore,
    communication_score: Math.round(communicationScore),
    content_score: Math.round(contentScore),
    participation_score: Math.round(participationScore),
    collaboration_score: Math.round(collaborationScore),
    leadership_score: Math.round(leadershipScore),
    strengths,
    improvements,
    feedback,
  };
}

function standardDeviation(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

module.exports = { evaluateParticipant };
