// Fades sections in once as they scroll into view. Without IntersectionObserver nothing is hidden.
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const sections = document.querySelectorAll('main > section:not(:first-child)');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const s of sections) {
    s.classList.add('reveal');
    io.observe(s);
  }
}
