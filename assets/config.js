/* aRKtuar AI - public client configuration.
   These values are safe to publish: the publishable key only allows what
   Row Level Security and the Edge Function permit. The Anthropic API key
   never reaches the browser; it lives as a Supabase Edge Function secret. */
window.ARK_CONFIG = {
  supabaseUrl: 'https://jggosolvobyfvablywzi.supabase.co',
  supabaseKey: '',
  aiEnabled: false,
  aiFunction: 'arktuar-ai',
  maxFileMB: 8,
  version: 'v1.2.0'
};
