type P = { className?: string }

export function ChromeIcon({ className = "w-5 h-5" }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#fff" />
      <path d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.33 2.5L4.2 5.5A10 10 0 0 1 12 2Z" fill="#ea4335" />
      <path d="M20.66 7A10 10 0 0 1 12 22l3.46-6A5 5 0 0 0 16.33 9.5 5 5 0 0 0 15.46 7Z" fill="#fbbc04" />
      <path d="M12 22A10 10 0 0 1 4.2 5.5L7.67 11.5A5 5 0 0 0 12 17a5 5 0 0 0 3.46-1Z" fill="#34a853" />
      <circle cx="12" cy="12" r="3.6" fill="#4285f4" stroke="#fff" strokeWidth="1.4" />
    </svg>
  )
}
