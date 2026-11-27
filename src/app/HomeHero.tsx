import type { ReactNode } from 'react';

export function HomeHero({ actions, lessonMinutes }: { actions: ReactNode; lessonMinutes: number }) {
  return <section className="home-hero" aria-labelledby="home-title">
    <div className="home-hero-copy">
      <p className="eyebrow">Учебная лаборатория · Волмакс</p>
      <h1 id="home-title">Волмакс · Тёплый пол</h1>
      <p className="intro">За {lessonMinutes} минут проследите путь воды от подачи до обратки. Или соберите и испытайте собственную схему.</p>
      <div className="actions">{actions}<a href="#lessons" className="hero-link">К учебным заданиям <span aria-hidden="true">↓</span></a></div>
    </div>
    <div className="home-visual" aria-hidden="true">
      <span>СХЕМА 01</span>
      <svg viewBox="0 0 400 225" focusable="false">
        <defs>
          <pattern id="hero-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#87aaa7" strokeOpacity=".16"/></pattern>
          <linearGradient id="hero-flow" x1="0" x2="1" y1="0" y2="0"><stop stopColor="#ff986b"/><stop offset="1" stopColor="#ffd0a0"/></linearGradient>
        </defs>
        <rect width="400" height="225" rx="15" fill="url(#hero-grid)"/>
        <rect x="113" y="29" width="254" height="166" rx="5" fill="#163d41" fillOpacity=".75" stroke="#82a9a7" strokeOpacity=".5"/>
        <path d="M110 68H82V88H38V151H82V168H110" fill="none" stroke="#83d9ca" strokeWidth="3.5" strokeLinejoin="round"/>
        <path d="M118 58H328Q344 58 344 74t-16 16H155q-16 0-16 16t16 16h173q16 0 16 16t-16 16H155q-16 0-16 16t16 16H118" fill="none" stroke="url(#hero-flow)" strokeWidth="4" strokeLinecap="round"/>
        <path d="M118 49V196" stroke="#bdeddf" strokeWidth="6" strokeLinecap="round"/>
        <rect x="27" y="104" width="22" height="28" rx="6" fill="#193639" stroke="#93dcca" strokeWidth="2"/>
        <circle cx="118" cy="70" r="6" fill="#87d7c9"/><circle cx="118" cy="166" r="6" fill="#87d7c9"/>
        <circle cx="257" cy="58" r="4" fill="#fff5e5"/><circle cx="278" cy="122" r="4" fill="#fff5e5"/>
        <path d="M365 28h13m-6-7v13M103 199H90m6-7v13" stroke="#9dd2c9" strokeOpacity=".56"/>
      </svg>
      <div><span>Водяной контур</span><span>Вид сверху</span></div>
    </div>
  </section>;
}
