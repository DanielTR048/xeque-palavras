import { useState } from 'react';
import { ArrowRight, Globe2, Smartphone } from 'lucide-react';
import type { Language } from '../game/engine';
import { PROFILES, type ProfileId } from './profiles';

export function ProfileChooser({ onSelect }: { onSelect: (profile: ProfileId) => void }) {
  const [language, setLanguage] = useState<Language>('pt');
  const english = language === 'en';
  return <main className="profile-screen">
    <header className="profile-header"><a className="profile-wordmark" href="/" aria-label="Xeque">♞ <span>xeque<i>.</i></span></a><button className="profile-language" onClick={() => setLanguage(english ? 'pt' : 'en')}><Globe2 size={16} />{english ? 'Português' : 'English'}</button></header>
    <div className="profile-ambient profile-ambient-one" aria-hidden="true" /><div className="profile-ambient profile-ambient-two" aria-hidden="true" />
    <section className="profile-center" aria-labelledby="profile-heading">
      <div className="profile-eyebrow">THE WORD CHESS CLUB</div>
      <h1 id="profile-heading">{english ? 'Who’s playing?' : 'Quem vai jogar?'}</h1>
      <p>{english ? 'Your board. Your moves. Your own story.' : 'Seu tabuleiro. Suas jogadas. A sua história.'}</p>
      <div className="profile-options">{PROFILES.map((profile, index) => <button className={`profile-option profile-${profile.color}`} key={profile.id} onClick={() => onSelect(profile.id)} style={{ animationDelay: `${index * 100}ms` }} aria-label={profile.name}>
        <span className="profile-avatar"><span className="avatar-grid" aria-hidden="true" /><span className="avatar-orbit" aria-hidden="true" /><span className="avatar-piece" aria-hidden="true">{profile.piece}</span><span className="avatar-arrow"><ArrowRight size={21} /></span></span>
        <strong>{profile.name}</strong><small>{english ? 'Enter your board' : 'Entrar no seu tabuleiro'}</small>
      </button>)}</div>
      <div className="profile-sync-note"><Smartphone size={16} /><span>{english ? 'Separate progress. Together on web and Android.' : 'Cada um com seu progresso. No site e no Android.'}</span></div>
    </section>
    <footer className="profile-footer"><span>{english ? 'Every word, a new move.' : 'Cada palavra, uma jogada.'}</span><span className="profile-footer-checker" aria-hidden="true" /></footer>
  </main>;
}
