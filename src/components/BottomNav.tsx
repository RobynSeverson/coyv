import { NavLink } from 'react-router-dom'
import './BottomNav.css'

const LINKS = [
  { to: '/home', label: 'home' },
  { to: '/prints', label: 'prints' },
  { to: '/photos', label: 'photos' },
  { to: '/archive', label: 'archive' },
]

export default function BottomNav() {
  return (
    <nav className="bottomNav" aria-label="Primary">
      <ul className="bottomNav__list">
        {LINKS.map(({ to, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `bottomNav__link${isActive ? ' is-active' : ''}`
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
