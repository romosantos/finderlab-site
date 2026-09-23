(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches || !('IntersectionObserver' in window)) return;

  const sections = [...document.querySelectorAll('main > section > .wrap')];
  const observer = new IntersectionObserver((entries, activeObserver) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      target.classList.add('is-visible');
      activeObserver.unobserve(target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  sections.forEach((section) => {
    if (section.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    section.classList.add('motion-ready');
    observer.observe(section);
  });
})();
