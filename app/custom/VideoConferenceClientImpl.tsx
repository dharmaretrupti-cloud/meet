'use client';

import { formatChatMessageLinks, RoomContext, VideoConference } from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  LogLevel,
  Room,
  RoomConnectOptions,
  RoomOptions,
  VideoPresets,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  Track,
  type VideoCodec,
} from 'livekit-client';
import { DebugMode } from '@/lib/Debug';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';

export function VideoConferenceClientImpl(props: {
  liveKitUrl: string;
  token: string;
  codec: VideoCodec | undefined;
  singlePeerConnection: boolean | undefined;
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = useState(false);

  const roomOptions = useMemo((): RoomOptions => {
    return {
      publishDefaults: {
        videoSimulcastLayers: [VideoPresets.h540, VideoPresets.h216],
        red: !e2eeEnabled,
        videoCodec: props.codec,
      },
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: true,
      e2ee: e2eeEnabled
        ? {
            keyProvider,
            worker,
          }
        : undefined,
      singlePeerConnection: props.singlePeerConnection,
    };
  }, [e2eeEnabled, props.codec, keyProvider, worker]);

  const room = useMemo<Room>(() => {
    return new Room(roomOptions);
  }, [roomOptions]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const audioSourcesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const transcriptSavedRef = useRef(false);
  const recordingStartedAtRef = useRef<number>(0);

  const addAudioTrackToTranscript = useCallback((mediaStreamTrack: MediaStreamTrack) => {
    const audioContext = audioContextRef.current;
    const destination = audioDestinationRef.current;
    if (!audioContext || !destination || mediaStreamTrack.readyState === 'ended') return;
    const source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    source.connect(destination);
    audioSourcesRef.current.push(source);
  }, []);

  const startTranscriptRecording = useCallback(() => {
    if (recorderRef.current || typeof MediaRecorder === 'undefined') return;
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(destination.stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recorderChunksRef.current.push(event.data);
    };
    recorder.start(1_000);
    recordingStartedAtRef.current = Date.now();
    audioContextRef.current = audioContext;
    audioDestinationRef.current = destination;
    recorderRef.current = recorder;
    room.localParticipant.audioTrackPublications.forEach((publication) => {
      if (publication.track) addAudioTrackToTranscript(publication.track.mediaStreamTrack);
    });
  }, [addAudioTrackToTranscript, room]);

  const saveTranscript = useCallback(async () => {
    if (transcriptSavedRef.current) return;
    transcriptSavedRef.current = true;
    const recorder = recorderRef.current;
    if (!recorder) return;
    const recording = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(recorderChunksRef.current, { type: recorder.mimeType }));
      recorder.stop();
    });
    audioSourcesRef.current.forEach((source) => source.disconnect());
    await audioContextRef.current?.close();
    if (recording.size === 0) return;
    const formData = new FormData();
    formData.append('roomName', room.name || 'custom-room');
    formData.append('speakerName', room.localParticipant.name || room.localParticipant.identity || 'Participant');
    formData.append('startedAt', String(recordingStartedAtRef.current));
    formData.append('audio', recording, 'meeting.webm');
    const response = await fetch('/api/transcripts', { method: 'POST', body: formData });
    if (!response.ok) throw new Error('The meeting transcript could not be saved.');
  }, [room.name]);

  const connectOptions = useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  useEffect(() => {
    if (e2eeEnabled) {
      keyProvider.setKey(e2eePassphrase).then(() => {
        room.setE2EEEnabled(true).then(() => {
          setE2eeSetupComplete(true);
        });
      });
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, e2eePassphrase, keyProvider, room, setE2eeSetupComplete]);

  useEffect(() => {
    const handleConnected = () => {
      console.info('[Transcript] LiveKit connected; starting audio recorder.');
      startTranscriptRecording();
    };
    const handleLocalTrackPublished = (publication: { track?: { kind: Track.Kind; mediaStreamTrack: MediaStreamTrack } }) => {
      if (publication.track?.kind === Track.Kind.Audio) {
        addAudioTrackToTranscript(publication.track.mediaStreamTrack);
      }
    };
    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    return () => {
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    };
  }, [addAudioTrackToTranscript, room, startTranscriptRecording]);

  useEffect(() => {
    const handleDisconnected = () => {
      saveTranscript().catch((error) => console.error('Failed to save meeting transcript:', error));
    };
    room.on(RoomEvent.Disconnected, handleDisconnected);
    return () => room.off(RoomEvent.Disconnected, handleDisconnected);
  }, [room, saveTranscript]);

  useEffect(() => {
    if (e2eeSetupComplete) {
      room.connect(props.liveKitUrl, props.token, connectOptions).catch((error) => {
        console.error(error);
      });
      room.localParticipant.enableCameraAndMicrophone().then(startTranscriptRecording).catch((error) => {
        console.error(error);
      });
    }
  }, [room, props.liveKitUrl, props.token, connectOptions, e2eeSetupComplete, startTranscriptRecording]);
  
  useLowCPUOptimizer(room);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={
            process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU === 'true' ? SettingsMenu : undefined
          }
        />
        <DebugMode logLevel={LogLevel.debug} />
      </RoomContext.Provider>
    </div>
  );
}
