'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
} from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  TrackPublishDefaults,
  VideoCaptureOptions,
  RemoteTrack,
  RemoteParticipant,
  Track,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  singlePeerConnection: boolean;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    const connectionDetailsResp = await fetch(url.toString());
    const connectionDetailsData = await connectionDetailsResp.json();
    setConnectionDetails(connectionDetailsData);
  }, []);
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <PreJoin
            defaults={preJoinDefaults}
            onSubmit={handlePreJoinSubmit}
            onError={handlePreJoinError}
          />
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{
            codec: props.codec,
            hq: props.hq,
            singlePeerConnection: props.singlePeerConnection,
          }}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
    singlePeerConnection: boolean;
  };
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h720,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h540, VideoPresets.h216],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
      },
      adaptiveStream: true,
      dynacast: true,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const audioDestinationRef = React.useRef<MediaStreamAudioDestinationNode | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const recorderChunksRef = React.useRef<Blob[]>([]);
  const audioSourcesRef = React.useRef<MediaStreamAudioSourceNode[]>([]);
  const transcriptSavedRef = React.useRef(false);
  const recordingStartedAtRef = React.useRef<number>(0);

  const addAudioTrackToTranscript = React.useCallback((mediaStreamTrack: MediaStreamTrack) => {
    const audioContext = audioContextRef.current;
    const destination = audioDestinationRef.current;
    if (!audioContext || !destination || mediaStreamTrack.readyState === 'ended') return;
    const source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    source.connect(destination);
    audioSourcesRef.current.push(source);
  }, []);

  const startTranscriptRecording = React.useCallback(() => {
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

  const saveTranscript = React.useCallback(async () => {
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
    formData.append('roomName', room.name);
    formData.append('speakerName', props.userChoices.username || room.localParticipant.name || 'Participant');
    formData.append('startedAt', String(recordingStartedAtRef.current));
    formData.append('audio', recording, 'meeting.webm');
    const response = await fetch('/api/transcripts', { method: 'POST', body: formData });
    if (!response.ok) throw new Error('The meeting transcript could not be saved.');
  }, [props.userChoices.username, room.localParticipant.name, room.name]);

  React.useEffect(() => {
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
  
  console.log("########################");
  console.log("MY CODE IS RUNNING");
  console.log(room);
  console.log("########################");

  React.useEffect(() => {
  console.log("✅ Registering TrackSubscribed listener");

  const handleTrackSubscribed = (
    track: RemoteTrack,
    publication: any,
    participant: RemoteParticipant
  ) => {
    console.log("🔥 TrackSubscribed fired");
    console.log("Participant:", participant.identity);
    console.log("Track kind:", track.kind);

    if (track.kind === Track.Kind.Audio) {
      console.log("🎤 Remote audio received!");
    }
  };

  room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);

  return () => {
    room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
  };
}, [room]);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete) {
      const connectRoom = async () => {
        await room.connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        );
        if (props.userChoices.videoEnabled) {
          await room.localParticipant.setCameraEnabled(true);
        }
        if (props.userChoices.audioEnabled) {
          await room.localParticipant.setMicrophoneEnabled(true);
          startTranscriptRecording();
        }
      };
      connectRoom().catch((error) => {
          handleError(error);
      });
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [
    e2eeSetupComplete,
    room,
    props.connectionDetails,
    props.userChoices,
    startTranscriptRecording,
  ]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => {
    saveTranscript()
      .catch((error) => console.error('Failed to save meeting transcript:', error))
      .finally(() => router.push('/'));
  }, [router, saveTranscript]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    alert(`Encountered an unexpected error, check the console logs for details: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
        />
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
