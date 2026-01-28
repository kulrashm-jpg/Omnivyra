import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Play, 
  Pause, 
  Square, 
  Upload, 
  Trash2, 
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Volume2,
  FileAudio,
  Sparkles,
  Brain
} from 'lucide-react';

interface VoiceNote {
  id: string;
  text: string;
  audioUrl: string;
  duration: number;
  confidence: number;
  keywords: string[];
  suggestions: any[];
  createdAt: string;
  context: 'campaign' | 'weekly' | 'daily';
}

interface VoiceNotesComponentProps {
  context: 'campaign' | 'weekly' | 'daily';
  campaignId?: string;
  weekNumber?: number;
  dayNumber?: number;
  onTranscriptionComplete?: (transcription: any) => void;
  onSuggestionApply?: (suggestion: any) => void;
}

export default function VoiceNotesComponent({ 
  context, 
  campaignId, 
  weekNumber, 
  dayNumber,
  onTranscriptionComplete,
  onSuggestionApply 
}: VoiceNotesComponentProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [currentTranscription, setCurrentTranscription] = useState<any>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    loadVoiceNotes();
  }, [context, campaignId, weekNumber, dayNumber]);

  const loadVoiceNotes = async () => {
    try {
      const params = new URLSearchParams({
        context,
        ...(campaignId && { campaignId }),
        ...(weekNumber && { weekNumber: weekNumber.toString() }),
        ...(dayNumber && { dayNumber: dayNumber.toString() })
      });

      const response = await fetch(`/api/voice/notes?${params}`);
      if (response.ok) {
        const data = await response.json();
        setVoiceNotes(data.notes || []);
      }
    } catch (error) {
      console.error('Error loading voice notes:', error);
    }
  };

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      const chunks: Blob[] = [];
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      
      recorder.onstop = () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        setAudioChunks(chunks);
        processRecording(audioBlob);
      };
      
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setError('Failed to start recording. Please check microphone permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  };

  const processRecording = async (audioBlob: Blob) => {
    setIsProcessing(true);
    
    try {
      // Convert blob to base64 using FileReader (more efficient for large files)
      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove the data URL prefix to get just the base64 string
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });
      
      const audioDataUrl = `data:audio/webm;base64,${base64Audio}`;
      
      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioFile: audioDataUrl,
          provider: 'whisper',
          context: context
        })
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const result = await response.json();
      
      if (result.success) {
        const voiceNote: VoiceNote = {
          id: `voice-${Date.now()}`,
          text: result.transcription,
          audioUrl: audioDataUrl,
          duration: result.duration,
          confidence: result.confidence,
          keywords: result.keywords,
          suggestions: result.suggestions,
          createdAt: new Date().toISOString(),
          context: context
        };
        
        setVoiceNotes(prev => [voiceNote, ...prev]);
        setCurrentTranscription(result);
        setShowSuggestions(true);
        
        // Save voice note
        await saveVoiceNote(voiceNote);
        
        // Notify parent component
        if (onTranscriptionComplete) {
          onTranscriptionComplete(result);
        }
      } else {
        throw new Error(result.error || 'Transcription failed');
      }
      
    } catch (error) {
      console.error('Error processing recording:', error);
      setError('Failed to process voice note. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const saveVoiceNote = async (voiceNote: VoiceNote) => {
    try {
      await fetch('/api/voice/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...voiceNote,
          campaignId,
          weekNumber,
          dayNumber
        })
      });
    } catch (error) {
      console.error('Error saving voice note:', error);
    }
  };

  const applySuggestion = async (suggestion: any) => {
    try {
      if (onSuggestionApply) {
        onSuggestionApply(suggestion);
      }
      
      // Mark suggestion as applied
      setCurrentTranscription(prev => ({
        ...prev,
        suggestions: prev.suggestions.map(s => 
          s === suggestion ? { ...s, applied: true } : s
        )
      }));
      
    } catch (error) {
      console.error('Error applying suggestion:', error);
    }
  };

  const deleteVoiceNote = async (noteId: string) => {
    try {
      await fetch(`/api/voice/notes/${noteId}`, {
        method: 'DELETE'
      });
      
      setVoiceNotes(prev => prev.filter(note => note.id !== noteId));
    } catch (error) {
      console.error('Error deleting voice note:', error);
    }
  };

  const playAudio = (audioUrl: string) => {
    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play();
    }
  };

  const getContextTitle = () => {
    switch (context) {
      case 'campaign': return 'Campaign Planning';
      case 'weekly': return `Week ${weekNumber} Planning`;
      case 'daily': return `Day ${dayNumber} Planning`;
      default: return 'Voice Notes';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-lg">
            <Mic className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Voice Notes</h3>
            <p className="text-sm text-gray-600">{getContextTitle()}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {!isRecording ? (
            <button
              onClick={startRecording}
              disabled={isProcessing}
              className="bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              <Mic className="h-4 w-4" />
              Start Recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              <Square className="h-4 w-4" />
              Stop Recording
            </button>
          )}
        </div>
      </div>

      {/* Recording Status */}
      {isRecording && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-red-700 font-medium">Recording in progress...</span>
          </div>
        </div>
      )}

      {/* Processing Status */}
      {isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-blue-700 font-medium">Processing voice note...</span>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <span className="text-red-700">{error}</span>
          </div>
        </div>
      )}

      {/* AI Suggestions */}
      {showSuggestions && currentTranscription?.suggestions?.length > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-4 mb-6 border border-blue-200">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            AI Suggestions
          </h4>
          <div className="space-y-3">
            {currentTranscription.suggestions.map((suggestion: any, index: number) => (
              <div key={index} className="bg-white rounded-lg p-3 border border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="font-medium text-gray-900">{suggestion.title}</h5>
                  <button
                    onClick={() => applySuggestion(suggestion)}
                    disabled={suggestion.applied}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      suggestion.applied
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    }`}
                  >
                    {suggestion.applied ? (
                      <>
                        <CheckCircle className="h-3 w-3 inline mr-1" />
                        Applied
                      </>
                    ) : (
                      'Apply'
                    )}
                  </button>
                </div>
                <p className="text-sm text-gray-600">{suggestion.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Voice Notes List */}
      <div className="space-y-4">
        {voiceNotes.length === 0 ? (
          <div className="text-center py-8">
            <FileAudio className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No voice notes yet</h4>
            <p className="text-gray-600">Start recording to capture your ideas and thoughts</p>
          </div>
        ) : (
          voiceNotes.map((note) => (
            <div key={note.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-gray-600" />
                  <span className="text-sm text-gray-500">
                    {new Date(note.createdAt).toLocaleString()}
                  </span>
                  <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                    {Math.round(note.confidence * 100)}% confidence
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => playAudio(note.audioUrl)}
                    className="p-1 hover:bg-gray-200 rounded text-gray-600"
                    title="Play audio"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteVoiceNote(note.id)}
                    className="p-1 hover:bg-red-100 rounded text-red-600"
                    title="Delete note"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <div className="space-y-3">
                <p className="text-gray-900">{note.text}</p>
                
                {note.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {note.keywords.slice(0, 5).map((keyword, index) => (
                      <span key={index} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                        {keyword}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Hidden audio element for playback */}
      <audio ref={audioRef} />
    </div>
  );
}
