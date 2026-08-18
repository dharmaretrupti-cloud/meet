// import { mkdir, readFile, writeFile } from 'fs/promises';
// import path from 'path';
// import { NextRequest, NextResponse } from 'next/server';

// export const runtime = 'nodejs';

// type Utterance = { speaker: string; start: number; end: number; text: string };
// const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

// type Feedback = {
//   meetingSummary: string;
//   candidates: Array<{
//     name: string;
//     overallScore: number;
//     scores: { communication: number; collaboration: number; relevance: number; clarity: number };
//     strengths: string[];
//     improvements: string[];
//     feedback: string;
//   }>;
// };

// function feedbackAsText(feedback: Feedback) {
//   const candidates = feedback.candidates.map((candidate) => [
//     `Candidate: ${candidate.name}`,
//     `Overall score: ${candidate.overallScore}/100`,
//     `Scores: Communication ${candidate.scores.communication}/25 | Collaboration ${candidate.scores.collaboration}/25 | Relevance ${candidate.scores.relevance}/25 | Clarity ${candidate.scores.clarity}/25`,
//     `Feedback: ${candidate.feedback}`,
//     `Strengths: ${candidate.strengths.join('; ') || 'Not enough evidence'}`,
//     `Improvements: ${candidate.improvements.join('; ') || 'Not enough evidence'}`,
//   ].join('\n'));
//   return `GROUP DISCUSSION FEEDBACK REPORT\n\nDiscussion summary: ${feedback.meetingSummary}\n\n${candidates.join('\n\n')}`;
// }

// function responseText(result: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
//   return result.output
//     ?.flatMap((item) => item.content ?? [])
//     .filter((content) => content.type === 'output_text')
//     .map((content) => content.text ?? '')
//     .join('');
// }

// const feedbackSchema = {
//   type: 'object',
//   additionalProperties: false,
//   required: ['meetingSummary', 'candidates'],
//   properties: {
//     meetingSummary: { type: 'string' },
//     candidates: {
//       type: 'array',
//       items: {
//         type: 'object',
//         additionalProperties: false,
//         required: ['name', 'overallScore', 'scores', 'strengths', 'improvements', 'feedback'],
//         properties: {
//           name: { type: 'string' },
//           overallScore: { type: 'integer', minimum: 0, maximum: 100 },
//           scores: {
//             type: 'object',
//             additionalProperties: false,
//             required: ['communication', 'collaboration', 'relevance', 'clarity'],
//             properties: {
//               communication: { type: 'integer', minimum: 0, maximum: 25 },
//               collaboration: { type: 'integer', minimum: 0, maximum: 25 },
//               relevance: { type: 'integer', minimum: 0, maximum: 25 },
//               clarity: { type: 'integer', minimum: 0, maximum: 25 },
//             },
//           },
//           strengths: { type: 'array', items: { type: 'string' } },
//           improvements: { type: 'array', items: { type: 'string' } },
//           feedback: { type: 'string' },
//         },
//       },
//     },
//   },
// } as const;

// export async function GET(request: NextRequest) {
//   const roomName = new URL(request.url).searchParams.get('roomName');
//   if (!roomName) return NextResponse.json({ error: 'roomName is required.' }, { status: 400 });
//   try {
//     const file = path.join(process.cwd(), '.feedback-data', `${safeName(roomName)}.json`);
//     return NextResponse.json(JSON.parse(await readFile(file, 'utf8')));
//   } catch {
//     return NextResponse.json({ error: 'No saved feedback report exists for this meeting.' }, { status: 404 });
//   }
// }

// export async function POST(request: NextRequest) {
//   try {
//     if (!process.env.OPENAI_API_KEY) {
//       return NextResponse.json({ error: 'OPENAI_API_KEY is not configured on the server.' }, { status: 503 });
//     }
//     const { roomName } = await request.json();
//     if (typeof roomName !== 'string' || !roomName.trim()) {
//       return NextResponse.json({ error: 'roomName is required.' }, { status: 400 });
//     }

//     const transcriptFile = path.join(process.cwd(), '.transcript-data', `${safeName(roomName)}.json`);
//     const utterances = JSON.parse(await readFile(transcriptFile, 'utf8')) as Utterance[];
//     if (!utterances.length) return NextResponse.json({ error: 'No speech was found in this meeting.' }, { status: 404 });

//     const transcript = utterances
//       .sort((a, b) => a.start - b.start)
//       .map((item) => `${item.speaker}: ${item.text}`)
//       .join('\n');

//     const llmResponse = await fetch('https://api.openai.com/v1/responses', {
//       method: 'POST',
//       headers: {
//         Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({
//         model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
//         instructions: `You provide constructive, evidence-based group-discussion coaching. Assess only the words in the transcript. Give feedback to every named speaker using communication, collaboration, relevance, and clarity (25 points each). Do not infer personality or protected traits. Do not rank candidates or recommend hiring decisions. If a speaker has too little speech, clearly say that evidence is limited.`,
//         input: `Group discussion transcript:\n${transcript}`,
//         text: {
//           format: {
//             type: 'json_schema',
//             name: 'candidate_discussion_feedback',
//             strict: true,
//             schema: feedbackSchema,
//           },
//         },
//       }),
//     });
//     if (!llmResponse.ok) {
//       console.error('OpenAI feedback request failed:', await llmResponse.text());
//       return NextResponse.json({ error: 'The feedback service could not generate a result.' }, { status: 502 });
//     }
//     const result = await llmResponse.json();
//     const output = responseText(result);
//     if (!output) throw new Error('The feedback service returned no text.');
//     const feedback = JSON.parse(output) as Feedback;
//     const savedFeedback = { ...feedback, roomName, generatedAt: new Date().toISOString() };
//     const feedbackDataRoot = path.join(process.cwd(), '.feedback-data');
//     const reportRoot = path.join(process.cwd(), 'feedback-reports');
//     const room = safeName(roomName);
//     await Promise.all([mkdir(feedbackDataRoot, { recursive: true }), mkdir(reportRoot, { recursive: true })]);
//     await Promise.all([
//       writeFile(path.join(feedbackDataRoot, `${room}.json`), JSON.stringify(savedFeedback, null, 2), 'utf8'),
//       writeFile(path.join(reportRoot, `${room}-feedback.txt`), feedbackAsText(feedback), 'utf8'),
//     ]);
//     return NextResponse.json(savedFeedback);
//   } catch (error) {
//     console.error('Failed to generate feedback:', error);
//     return NextResponse.json({ error: 'Could not generate feedback for this meeting.' }, { status: 500 });
//   }
// }

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Utterance = { speaker: string; start: number; end: number; text: string };

type Feedback = {
  meetingSummary: string;
  candidates: Array<{
    name: string;
    overallScore: number;
    scores: {
      communication: number;
      collaboration: number;
      relevance: number;
      clarity: number;
    };
    strengths: string[];
    improvements: string[];
    feedback: string;
  }>;
};

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

function feedbackAsText(feedback: Feedback) {
  const candidates = feedback.candidates
    .map((candidate) =>
      [
        `Candidate: ${candidate.name}`,
        `Overall score: ${candidate.overallScore}/100`,
        `Scores: Communication ${candidate.scores.communication}/25 | Collaboration ${candidate.scores.collaboration}/25 | Relevance ${candidate.scores.relevance}/25 | Clarity ${candidate.scores.clarity}/25`,
        `Feedback: ${candidate.feedback}`,
        `Strengths: ${candidate.strengths.join('; ') || 'Not enough evidence'}`,
        `Improvements: ${candidate.improvements.join('; ') || 'Not enough evidence'}`,
      ].join('\n'),
    )
    .join('\n\n');

  return `GROUP DISCUSSION FEEDBACK REPORT\n\nDiscussion summary: ${feedback.meetingSummary}\n\n${candidates}`;
}

export async function GET(request: NextRequest) {
  const roomName = new URL(request.url).searchParams.get('roomName');

  if (!roomName) {
    return NextResponse.json({ error: 'roomName is required.' }, { status: 400 });
  }

  try {
    const file = path.join(
      process.cwd(),
      '.feedback-data',
      `${safeName(roomName)}.json`,
    );
    return NextResponse.json(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return NextResponse.json(
      { error: 'No saved feedback report exists for this meeting.' },
      { status: 404 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { roomName } = await request.json();

    if (typeof roomName !== 'string' || !roomName.trim()) {
      return NextResponse.json({ error: 'roomName is required.' }, { status: 400 });
    }

    const transcriptFile = path.join(
      process.cwd(),
      '.transcript-data',
      `${safeName(roomName)}.json`,
    );

    const utterances = JSON.parse(
      await readFile(transcriptFile, 'utf8'),
    ) as Utterance[];

    if (!utterances.length) {
      return NextResponse.json(
        { error: 'No speech was found in this meeting.' },
        { status: 404 },
      );
    }

    const transcript = utterances
      .sort((a, b) => a.start - b.start)
      .map((item) => `${item.speaker}: ${item.text}`)
      .join('\n');

    const prompt = `You are a group-discussion feedback assistant.

Assess only the words in this transcript. Do not infer personality, protected traits, or job suitability. Do not rank people or make hiring decisions.

For every named speaker, give:
- overallScore: integer out of 100
- communication, collaboration, relevance and clarity: integers out of 25
- strengths: array of short strings
- improvements: array of short strings
- feedback: short constructive paragraph

Return ONLY valid JSON in exactly this format:
{
  "meetingSummary": "short discussion summary",
  "candidates": [
    {
      "name": "speaker name",
      "overallScore": 0,
      "scores": {
        "communication": 0,
        "collaboration": 0,
        "relevance": 0,
        "clarity": 0
      },
      "strengths": ["strength"],
      "improvements": ["improvement"],
      "feedback": "constructive feedback"
    }
  ]
}

Transcript:
${transcript}`;

    const ollamaResponse = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt,
        stream: false,
        format: 'json',
      }),
    });

    if (!ollamaResponse.ok) {
      console.error('Ollama feedback request failed:', await ollamaResponse.text());
      return NextResponse.json(
        { error: 'Ollama could not generate feedback. Make sure Ollama is running.' },
        { status: 502 },
      );
    }

    const result = (await ollamaResponse.json()) as { response?: string };
    if (!result.response) {
      throw new Error('Ollama returned no feedback text.');
    }

    const feedback = JSON.parse(result.response) as Feedback;
    const savedFeedback = {
      ...feedback,
      roomName,
      generatedAt: new Date().toISOString(),
    };

    const feedbackDataRoot = path.join(process.cwd(), '.feedback-data');
    const reportRoot = path.join(process.cwd(), 'feedback-reports');
    const room = safeName(roomName);

    await Promise.all([
      mkdir(feedbackDataRoot, { recursive: true }),
      mkdir(reportRoot, { recursive: true }),
    ]);

    await Promise.all([
      writeFile(
        path.join(feedbackDataRoot, `${room}.json`),
        JSON.stringify(savedFeedback, null, 2),
        'utf8',
      ),
      writeFile(
        path.join(reportRoot, `${room}-feedback.txt`),
        feedbackAsText(feedback),
        'utf8',
      ),
    ]);

    return NextResponse.json(savedFeedback);
  } catch (error) {
    console.error('Failed to generate Ollama feedback:', error);
    return NextResponse.json(
      { error: 'Could not generate feedback for this meeting.' },
      { status: 500 },
    );
  }
}