import { FeedbackClient } from './FeedbackClient';

export default async function FeedbackPage({ params }: { params: Promise<{ roomName: string }> }) {
  const { roomName } = await params;
  return <FeedbackClient roomName={roomName} />;
}
