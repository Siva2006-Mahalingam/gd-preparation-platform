const config = require('../config');

/**
 * Evaluate an individual student's GD performance against the 8 core criteria:
 * 1. Content Quality: Relevance, clarity, reasoning, examples and understanding of the topic
 * 2. Communication: Clarity, organization and effectiveness of expression
 * 3. Participation: Meaningful contribution and consistency throughout the GD
 * 4. Relevance: Whether the participant stays connected to the GD topic
 * 5. Team Interaction: Ability to respond to and build upon other participants' points
 * 6. Confidence: Delivery characteristics observable from the recorded contribution
 * 7. Leadership: Initiative, constructive direction and ability to move discussion forward
 * 8. Overall Performance: Overall quality based on the above evidence
 */
async function evaluateParticipant(participantData) {
  // Try external LLM API first
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

      let evalText = data.text
        || data.content
        || (data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text))
        || (data.candidates && data.candidates[0] && data.candidates[0].content?.parts?.[0]?.text)
        || null;

      if (evalText) {
        const jsonMatch = evalText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, evalText];
        const parsed = JSON.parse(jsonMatch[1].trim());
        return normalizeEvaluation(parsed);
      }

      console.warn('⚠️ Could not parse evaluation from API. Using metrics-based evaluation.');
    } catch (err) {
      console.warn('⚠️ Evaluation API call failed:', err.message, '— Using metrics-based evaluation.');
    }
  }

  // Fallback: comprehensive metrics-based evaluation
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

  return `You are an expert assessor and panel judge for student Group Discussions (GD).
Evaluate the following student's individual performance fairly, constructively, and realistically.

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

You MUST evaluate the candidate on these exact 8 criteria:
1. Content Quality: Relevance, clarity, reasoning, examples and understanding of the topic
2. Communication: Clarity, organization and effectiveness of expression
3. Participation: Meaningful contribution and consistency throughout the GD
4. Relevance: Whether the participant stays connected to the GD topic
5. Team Interaction: Ability to respond to and build upon other participants' points
6. Confidence: Delivery characteristics observable from the recorded contribution
7. Leadership: Initiative, constructive direction and ability to move discussion forward
8. Overall Performance: Overall quality based on the above evidence

Return a valid JSON object with exactly these fields (scores between 0 and 100):
{
  "overall_score": <number 0-100>,
  "content_quality_score": <number 0-100>,
  "communication_score": <number 0-100>,
  "participation_score": <number 0-100>,
  "relevance_score": <number 0-100>,
  "team_interaction_score": <number 0-100>,
  "confidence_score": <number 0-100>,
  "leadership_score": <number 0-100>,
  "strengths": [<2-4 specific strengths, referencing what was said>],
  "improvements": [<2-4 specific, actionable improvement points>],
  "feedback": "<detailed, personalized constructive paragraph addressed to ${data.username}>"
}

Return ONLY the JSON object, no other text.`;
}

function normalizeEvaluation(parsed) {
  const contentQuality = clamp(parsed.content_quality_score ?? parsed.content_score ?? 0, 0, 100);
  const communication = clamp(parsed.communication_score ?? 0, 0, 100);
  const participation = clamp(parsed.participation_score ?? 0, 0, 100);
  const relevance = clamp(parsed.relevance_score ?? contentQuality, 0, 100);
  const teamInteraction = clamp(parsed.team_interaction_score ?? parsed.collaboration_score ?? 0, 0, 100);
  const confidence = clamp(parsed.confidence_score ?? Math.round((communication + (parsed.leadership_score || 0)) / 2), 0, 100);
  const leadership = clamp(parsed.leadership_score ?? 0, 0, 100);

  const overall = clamp(
    parsed.overall_score ?? Math.round(
      contentQuality * 0.20 +
      communication * 0.15 +
      participation * 0.15 +
      relevance * 0.15 +
      teamInteraction * 0.15 +
      confidence * 0.10 +
      leadership * 0.10
    ),
    0, 100
  );

  return {
    overall_score: overall,
    content_quality_score: contentQuality,
    content_score: contentQuality, // DB backward compat
    communication_score: communication,
    participation_score: participation,
    relevance_score: relevance,
    team_interaction_score: teamInteraction,
    collaboration_score: teamInteraction, // DB backward compat
    confidence_score: confidence,
    leadership_score: leadership,
    criteria: {
      content_quality: {
        label: 'Content Quality',
        description: 'Relevance, clarity, reasoning, examples and understanding of the topic',
        score: contentQuality,
      },
      communication: {
        label: 'Communication',
        description: 'Clarity, organization and effectiveness of expression',
        score: communication,
      },
      participation: {
        label: 'Participation',
        description: 'Meaningful contribution and consistency throughout the GD',
        score: participation,
      },
      relevance: {
        label: 'Relevance',
        description: 'Whether the participant stays connected to the GD topic',
        score: relevance,
      },
      team_interaction: {
        label: 'Team Interaction',
        description: "Ability to respond to and build upon other participants' points",
        score: teamInteraction,
      },
      confidence: {
        label: 'Confidence',
        description: 'Delivery characteristics observable from the recorded contribution',
        score: confidence,
      },
      leadership: {
        label: 'Leadership',
        description: 'Initiative, constructive direction and ability to move discussion forward',
        score: leadership,
      },
      overall_performance: {
        label: 'Overall Performance',
        description: 'Overall quality based on the above evidence',
        score: overall,
      },
    },
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    feedback: parsed.feedback || '',
  };
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, Number(val) || 0));
}

/**
 * Generate evaluation based purely on participation metrics and transcripts.
 * Used when no external eval API is configured or as fallback.
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
    contributions = [],
  } = data;

  const speakingPct = (totalSpeakingTime / Math.max(discussionDuration, 1)) * 100;
  const idealPct = 100 / Math.max(totalParticipants, 1);
  const hasContributions = contributionCount > 0;

  // Total words spoken
  const totalWords = contributions.reduce((acc, c) => {
    return acc + (c.transcript ? c.transcript.trim().split(/\s+/).filter(Boolean).length : 0);
  }, 0);

  // 1. Participation: Meaningful contribution and consistency throughout the GD
  let participationScore = 0;
  if (hasContributions) {
    const pctRatio = Math.min(speakingPct / idealPct, 2);
    participationScore = Math.min(100, pctRatio * 45);
    if (contributionCount >= 2) participationScore += 20;
    if (contributionCount >= 4) participationScore += 15;
    if (contributionTimestamps.length > 0 && contributionTimestamps[0] < discussionDuration * 0.25) {
      participationScore += 10;
    }
    participationScore = clamp(participationScore, 0, 100);
  }

  // 2. Communication: Clarity, organization and effectiveness of expression
  let communicationScore = 0;
  if (hasContributions) {
    const avgDuration = totalSpeakingTime / contributionCount;
    if (avgDuration >= 12 && avgDuration <= 50) {
      communicationScore = 75 + Math.min(25, (avgDuration / 40) * 25);
    } else if (avgDuration < 12) {
      communicationScore = 40 + (avgDuration / 12) * 30;
    } else {
      communicationScore = Math.max(40, 75 - ((avgDuration - 50) / 30) * 20);
    }
    if (totalWords > 40) communicationScore += 10;
    communicationScore = clamp(communicationScore, 0, 100);
  }

  // 3. Content Quality: Relevance, clarity, reasoning, examples and understanding
  let contentScore = 0;
  if (hasContributions) {
    const durationVariance = contributionDurations.length > 1
      ? standardDeviation(contributionDurations)
      : 0;
    contentScore = Math.min(100,
      35 + (contributionCount * 12) + (durationVariance > 4 ? 15 : 0) + (totalWords > 50 ? 20 : 10)
    );
    contentScore = clamp(contentScore, 0, 100);
  }

  // 4. Relevance: Whether the participant stays connected to the GD topic
  let relevanceScore = 0;
  if (hasContributions) {
    relevanceScore = Math.min(100, Math.round(contentScore * 0.9 + 10));
    relevanceScore = clamp(relevanceScore, 0, 100);
  }

  // 5. Team Interaction: Ability to respond to and build upon other participants' points
  let teamInteractionScore = 0;
  if (hasContributions) {
    if (speakingPct <= idealPct * 1.4) {
      teamInteractionScore = 80;
    } else if (speakingPct <= idealPct * 2) {
      teamInteractionScore = 65;
    } else {
      teamInteractionScore = 45;
    }

    if (contributionTimestamps.length >= 2) {
      const gaps = [];
      for (let i = 1; i < contributionTimestamps.length; i++) {
        gaps.push(contributionTimestamps[i] - contributionTimestamps[i - 1]);
      }
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (avgGap > 15) teamInteractionScore += 15;
    }
    teamInteractionScore = clamp(teamInteractionScore, 0, 100);
  }

  // 6. Confidence: Delivery characteristics observable from the recorded contribution
  let confidenceScore = 0;
  if (hasContributions) {
    const speechPaceWpm = totalSpeakingTime > 0 ? (totalWords / (totalSpeakingTime / 60)) : 0;
    if (speechPaceWpm >= 80 && speechPaceWpm <= 160) {
      confidenceScore = 82;
    } else if (speechPaceWpm > 0) {
      confidenceScore = 68;
    } else {
      confidenceScore = 60;
    }
    if (totalSpeakingTime >= 20) confidenceScore += 15;
    confidenceScore = clamp(confidenceScore, 0, 100);
  }

  // 7. Leadership: Initiative, constructive direction and ability to move discussion forward
  let leadershipScore = 0;
  if (hasContributions) {
    if (contributionTimestamps[0] < discussionDuration * 0.15) {
      leadershipScore += 40;
    } else if (contributionTimestamps[0] < discussionDuration * 0.3) {
      leadershipScore += 25;
    }
    if (contributionTimestamps.length > 0) {
      const lastContrib = contributionTimestamps[contributionTimestamps.length - 1];
      if (lastContrib > discussionDuration * 0.65) {
        leadershipScore += 25;
      }
    }
    if (contributionCount >= 3) leadershipScore += 20;
    leadershipScore = clamp(leadershipScore, 0, 100);
  }

  // 8. Overall Performance: Weighted composite based on the above evidence
  const overallScore = Math.round(
    contentScore * 0.20 +
    communicationScore * 0.15 +
    participationScore * 0.15 +
    relevanceScore * 0.15 +
    teamInteractionScore * 0.15 +
    confidenceScore * 0.10 +
    leadershipScore * 0.10
  );

  // Strengths & Improvements
  const strengths = [];
  const improvements = [];

  if (contentScore >= 70) strengths.push('Strong content quality with logical reasoning on the topic');
  else if (contentScore < 50) improvements.push('Enhance content quality by using concrete examples and data');

  if (communicationScore >= 70) strengths.push('Clear, articulate expression and well-paced delivery');
  else if (communicationScore < 50) improvements.push('Work on structuring points clearly with structured beginning, middle, and conclusion');

  if (participationScore >= 70) strengths.push('Consistent participation across the discussion timeline');
  else if (participationScore < 50) improvements.push('Increase your participation frequency to maintain consistency throughout the GD');

  if (relevanceScore >= 75) strengths.push('Remained closely connected to the core discussion topic');
  else if (relevanceScore < 50) improvements.push('Ensure every contribution directly addresses the core theme');

  if (teamInteractionScore >= 75) strengths.push('Excellent team interaction — balanced speaking time and built on ideas');
  else if (teamInteractionScore < 50) improvements.push('Acknowledge peers points before transitioning into your own arguments');

  if (confidenceScore >= 75) strengths.push('Demonstrated strong vocal confidence and steady flow');
  else if (confidenceScore < 50) improvements.push('Practice speaking without hesitation to project greater confidence');

  if (leadershipScore >= 65) strengths.push('Showed leadership initiative by guiding discussion direction');
  else if (leadershipScore < 40) improvements.push('Take initiative earlier in the GD to establish a leadership presence');

  if (contributionCount === 0) {
    improvements.push('Make at least one spoken contribution in your next session');
    improvements.push('Even a brief comment demonstrates initiative');
  }

  if (strengths.length === 0) strengths.push('Participated attentively in the group discussion');

  // Feedback
  let feedback = '';
  if (!hasContributions) {
    feedback = `${username}, you did not make any spoken contributions during this session. In Group Discussions, active participation is critical. Try to speak early to build confidence and take initiative.`;
  } else if (overallScore >= 75) {
    feedback = `Outstanding performance, ${username}! You demonstrated strong content quality, vocal confidence, and balanced team interaction across ${contributionCount} speaking turns (${totalSpeakingTime.toFixed(0)}s total). Keep refining your opening and closing synthesis.`;
  } else if (overallScore >= 50) {
    feedback = `Solid effort, ${username}. You participated with ${contributionCount} contribution(s) totaling ${totalSpeakingTime.toFixed(0)}s. To reach top placement standards, focus on building directly on teammates' arguments and speaking with sharper structure.`;
  } else {
    feedback = `${username}, you contributed ${contributionCount} time(s). Focus on stepping forward earlier, keeping points tightly relevant to the topic, and delivering with steady confidence.`;
  }

  return normalizeEvaluation({
    overall_score: overallScore,
    content_quality_score: Math.round(contentScore),
    communication_score: Math.round(communicationScore),
    participation_score: Math.round(participationScore),
    relevance_score: Math.round(relevanceScore),
    team_interaction_score: Math.round(teamInteractionScore),
    confidence_score: Math.round(confidenceScore),
    leadership_score: Math.round(leadershipScore),
    strengths,
    improvements,
    feedback,
  });
}

function standardDeviation(arr) {
  if (!arr || arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

module.exports = { evaluateParticipant };
