export interface User {
  id: string;
  telegram_id: number;
  name: string;
  avatar: string;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
  extracted_date: string | null;
  ai_summary: string | null;
  ai_topics: string[];
  ai_keywords: string[];
  embedding: number[] | null;
  telegram_message_id: number | null;
  analyzed: boolean;
  deleted_at: string | null;
  // Attachment pulled from Telegram (photo/video/voice/audio/document).
  media_url: string | null;
  media_type: string | null;
  // Auto-translation: when a foreign-language post is saved, `text` holds the English
  // translation, `original_text` the (formatted) source, `source_lang` its code.
  original_text: string | null;
  source_lang: string | null;
  // Sticky-wall layout (null until the note is placed/styled on the wall).
  pos_x: number | null;
  pos_y: number | null;
  width: number | null;
  height: number | null;
  color: string | null;
  font: string | null;
  // Pinned to the top of the list view (Google Keep style).
  pinned: boolean;
  // Manual order of pinned notes in the list (legacy; superseded by list_x/y).
  list_order: number | null;
  // Free position of a pinned note in the list's pinned area (null = auto-grid).
  list_x: number | null;
  list_y: number | null;
}

export interface TopicGroup {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
  notes?: Note[];
}

export interface TopicGroupNote {
  topic_group_id: string;
  note_id: string;
}

export interface AuthState {
  user: User | null;
  loading: boolean;
  authenticated: boolean;
}

export interface AnalysisResult {
  summary: string;
  extractedDate: string | null;
  topics: string[];
  keywords: string[];
}

export interface SearchResult {
  notes: Note[];
  query: string;
}
