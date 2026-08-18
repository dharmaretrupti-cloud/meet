'use client';

import React from 'react';

type Candidate = {
  name: string;
  overallScore: number;
  scores: { communication: number; collaboration: number; relevance: number; clarity: number };
  strengths: string[];
  improvements: string[];
  feedback: string;
};
type Feedback = { meetingSummary: string; candidates: Candidate[]; generatedAt?: string };

export function FeedbackClient({ roomName }: { roomName: string }) {
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const generateFeedback = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to generate feedback.');
      setFeedback(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate feedback.');
    } finally {
      setLoading(false);
    }
  }, [roomName]);

  React.useEffect(() => {
    fetch(`/api/feedback?roomName=${encodeURIComponent(roomName)}`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((savedFeedback) => { if (savedFeedback) setFeedback(savedFeedback); })
      .catch(() => undefined);
  }, [roomName]);

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px', color: '#1f2937' }}>
      <h1>Group discussion feedback</h1>
      <p>AI coaching based only on the recorded transcript. Do not use this as an automated hiring decision.</p>
      <button onClick={generateFeedback} disabled={loading} style={{ padding: '12px 18px', margin: '16px 0 24px' }}>
        {loading ? 'Analysing conversation…' : feedback ? 'Generate again' : 'Generate feedback'}
      </button>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      {feedback && <>
        {feedback.generatedAt && <p style={{ color: '#4b5563' }}>Saved report: {new Date(feedback.generatedAt).toLocaleString()}</p>}
        <section style={{ background: '#f3f4f6', borderRadius: 12, padding: 18, marginBottom: 20 }}>
          <strong>Discussion summary</strong><p>{feedback.meetingSummary}</p>
        </section>
        {feedback.candidates.map((candidate) => (
          <article key={candidate.name} style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <h2>{candidate.name} — {candidate.overallScore}/100</h2>
            <p><strong>Scores:</strong> Communication {candidate.scores.communication}/25 · Collaboration {candidate.scores.collaboration}/25 · Relevance {candidate.scores.relevance}/25 · Clarity {candidate.scores.clarity}/25</p>
            <p>{candidate.feedback}</p>
            <p><strong>Strengths:</strong> {candidate.strengths.join(' · ')}</p>
            <p><strong>Improve next:</strong> {candidate.improvements.join(' · ')}</p>
          </article>
        ))}
      </>}
    </main>
  );
}
