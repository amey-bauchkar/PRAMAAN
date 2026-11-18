import Link from 'next/link';
import React from 'react';
import { Cta } from '@/components/Cta';
import { DecisionFlow } from '@/components/DecisionFlow';
import { EvidenceOrbit } from '@/components/EvidenceOrbit';
import { FeatureCarousel } from '@/components/FeatureCarousel';
import { HowItWorksSlider } from '@/components/HowItWorksSlider';
import { Reveal } from '@/components/Reveal';
import { TileSphere } from '@/components/TileSphere';

const AUDIENCE = [
  { who: 'Students', line: 'See what you need to do next to qualify for more companies, in English, Hindi or Marathi.' },
  { who: 'Placement officers', line: 'Set eligibility rules, check them for fairness, and give every student a clear reason for each decision.' },
  { who: 'Recruiters', line: 'Shortlist students by skills that have been checked, and see the proof behind each one.' },
  { who: 'Universities', line: 'See placement results across your colleges without seeing any one student’s details.' },
];

function PathMock() {
  return (
    <div className="rounded-3xl bg-ink p-6 text-white shadow-[0_30px_80px_-20px_rgb(0,0,0,.5)]">
      <p className="text-xs uppercase tracking-widest text-white/60">Your next step</p>
      <p className="mt-3 font-display text-2xl leading-tight">Pass the SQL test to apply to 2 more companies</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="grow-bar h-full w-2/3 rounded-full bg-brand" /></div>
      <p className="mt-2 text-xs text-white/60">About 4 hours · in time for both deadlines</p>
    </div>
  );
}

function PassMock() {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-[0_30px_80px_-20px_rgb(120,30,0,.45)]">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-lg text-white" aria-hidden>✓</span>
        <div><p className="text-sm font-medium">Eligible for Nimbus Analytics</p><p className="text-xs text-muted">Your marks are not shared</p></div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="overflow-x-clip">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/" className="font-display text-3xl font-medium tracking-tight">pramaan<span className="text-brand">.</span></Link>
          <nav aria-label="Primary" className="pill-nav hidden gap-1 p-1 text-sm md:flex">
            <a className="rounded-full px-4 py-1.5 hover:bg-white" href="#how">How it works</a>
            <a className="rounded-full px-4 py-1.5 hover:bg-white" href="#features">Features</a>
            <a className="rounded-full px-4 py-1.5 hover:bg-white" href="#who">Who it&apos;s for</a>
          </nav>
          <Cta href="/login" size="sm">Try the demo →</Cta>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative">
          <div className="grid-fade pointer-events-none absolute inset-x-0 top-0 h-[620px]" aria-hidden />
          <div className="relative mx-auto max-w-7xl px-4 pt-16 sm:px-8 sm:pt-24">
                        <Reveal delay={80}>
              <h1 className="mx-auto max-w-5xl text-center text-[2.9rem] leading-[1.02] sm:text-7xl lg:text-[6.5rem]">
                Skills you can prove.<br /><span className="bg-gradient-to-b from-[#111] to-[#8c8580] bg-clip-text text-transparent">Placements you can explain.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mx-auto mt-8 max-w-2xl text-center text-lg leading-8 text-muted sm:text-xl">
                Students prove their skills with real work. Colleges apply clear, fair rules for every company visit. Recruiters see checked skills instead of resume claims. Automated helpers can suggest, but people always decide.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <Cta href="/login" size="md">Try the live demo →</Cta>
                <a href="#how" className="rounded-[14px] border border-line bg-white px-7 py-[14px] text-base font-medium leading-none hover:border-brand">See how it works</a>
              </div>
              <p className="mt-4 text-center text-xs text-muted">The demo uses sample data. No real students, and no sign-up needed.</p>
            </Reveal>

            {/* Hero panel with floating product cards */}
            <Reveal delay={320}>
              <div className="hero-panel relative mx-auto mt-14 max-w-5xl overflow-hidden rounded-[2rem] px-5 py-8 sm:px-10 sm:py-10">
                <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(rgb(255_255_255/.6)_1px,transparent_1px)] [background-size:22px_22px]" aria-hidden />
                <div className="relative mx-auto grid max-w-4xl items-center gap-6 md:grid-cols-[1fr_1fr]">
                  <TileSphere count={900} className="mx-auto aspect-square w-full max-w-[300px]" />
                  <div className="flex flex-col gap-5">
                    <PathMock />
                    <PassMock />
                  </div>
                </div>
                <p className="relative mt-6 text-center font-display text-xl text-white sm:text-2xl">Verified means it was checked, not just written on a resume.</p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Problem */}
        <section className="mx-auto mt-24 max-w-5xl px-4 sm:mt-32 sm:px-8">
          <Reveal>
            <h2 className="text-4xl leading-[1.08] sm:text-6xl">
              A resume only shows what students <span className="text-muted/60">say</span>. Recruiters have to guess. Students are turned down without knowing why.
            </h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="mt-8 max-w-2xl text-xl leading-8 text-muted">
              PRAMAAN replaces the guess with proof anyone can check. Every student who is not selected gets a clear reason and a next step.
            </p>
          </Reveal>
        </section>

        {/* Evidence */}
        <section className="mx-auto mt-24 max-w-5xl px-4 sm:mt-32 sm:px-8">
          <div className="rounded-[2rem] bg-[#F8F4EE] px-4 py-12 sm:px-10 sm:py-14">
            <Reveal>
              <p className="text-center text-sm font-medium text-brand">One skill profile</p>
              <h2 className="mx-auto mt-3 max-w-2xl text-center text-3xl sm:text-5xl">Every piece of work is linked to the skill it proves.</h2>
            </Reveal>
            <div className="mt-8"><EvidenceOrbit /></div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto mt-24 max-w-7xl scroll-mt-20 px-4 sm:mt-32 sm:px-8">
          <Reveal><p className="text-sm font-medium text-brand">How it works</p><h2 className="mt-3 max-w-3xl text-4xl sm:text-6xl">From a resume claim to a campus offer in four steps.</h2></Reveal>
          <Reveal delay={80}><div className="mx-auto mt-12 max-w-4xl"><HowItWorksSlider /></div></Reveal>
        </section>

        {/* Decision flow */}
        <section className="mx-auto mt-24 max-w-7xl px-4 sm:mt-32 sm:px-8">
          <div className="rounded-[2.25rem] bg-[#F8F4EE] px-4 py-16 sm:px-10 sm:py-24">
            <Reveal>
              <p className="text-center text-sm font-medium text-brand">Clear decisions</p>
              <h2 className="mx-auto mt-3 max-w-3xl text-center text-4xl sm:text-6xl">Every eligibility decision comes with its reasons.</h2>
            </Reveal>
            <div className="mt-14"><DecisionFlow /></div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto mt-24 max-w-7xl scroll-mt-20 px-4 sm:mt-32 sm:px-8">
          <Reveal><p className="text-sm font-medium text-brand">What makes it different</p><h2 className="mt-3 max-w-3xl text-4xl sm:text-6xl">Built for proof, fairness and second chances.</h2></Reveal>
          <Reveal delay={80}><div className="mt-12"><FeatureCarousel /></div></Reveal>
        </section>

        {/* Audience */}
        <section id="who" className="mx-auto mt-24 max-w-7xl scroll-mt-20 px-4 sm:mt-32 sm:px-8">
          <Reveal><p className="text-sm font-medium text-brand">Who it&apos;s for</p><h2 className="mt-3 max-w-3xl text-4xl sm:text-6xl">One platform for four groups.</h2></Reveal>
          <div className="mt-12 divide-y divide-line border-y border-line">
            {AUDIENCE.map((a, i) => (
              <Reveal key={a.who} delay={i * 60}>
                <div className="group grid gap-2 py-8 transition hover:bg-card sm:grid-cols-[1fr_1.4fr_auto] sm:items-center sm:px-4">
                  <h3 className="text-3xl sm:text-4xl">{a.who}</h3>
                  <p className="text-lg text-muted">{a.line}</p>
                  <span className="hidden text-2xl text-brand transition group-hover:translate-x-1 sm:block" aria-hidden>→</span>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto mt-24 max-w-7xl px-4 pb-24 sm:mt-32 sm:px-8">
          <Reveal>
            <div className="hero-panel relative overflow-hidden rounded-[2.25rem] px-6 py-20 text-center text-white sm:py-28">
              <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(rgb(255_255_255/.6)_1px,transparent_1px)] [background-size:22px_22px]" aria-hidden />
              <h2 className="relative mx-auto max-w-3xl text-5xl sm:text-7xl">See placements run on proof.</h2>
              <p className="relative mx-auto mt-6 max-w-xl text-lg text-white/90">Sign in as a student, placement officer or recruiter and look around in under a minute.</p>
              <div className="relative mt-10 flex justify-center"><Cta href="/login" variant="light" size="md">Open the demo →</Cta></div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:px-8">
          <span className="font-display text-xl text-ink">pramaan<span className="text-brand">.</span></span>
          <span>The demo uses sample data only. No real students.</span>
        </div>
      </footer>
    </div>
  );
}
