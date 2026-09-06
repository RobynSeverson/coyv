import { NavLink } from 'react-router-dom'
import printsButton from '../assets/printsButton.jpeg'
import printsButtonActive from '../assets/printsButtonActive.png'
import './BottomNav.css'

type NavItem = {
  to: string
  label: string
  /* when present the label is drawn as artwork instead of text */
  image?: string
  activeImage?: string
}

const LINKS: NavItem[] = [
  { to: '/home', label: 'home' },
  {
    to: '/prints',
    label: 'prints',
    image: printsButton,
    activeImage: printsButtonActive,
  },
  { to: '/memories', label: 'memories' },
]

export default function BottomNav() {
  return (
    <nav className="bottomNav" aria-label="Primary">
      <ul className="bottomNav__list">
        {LINKS.map(({ to, label, image, activeImage }) => (
          <li key={to}>
            <NavLink
              to={to}
              aria-label={image ? label : undefined}
              className={({ isActive }) =>
                [
                  'bottomNav__link',
                  image ? 'bottomNav__link--image' : '',
                  isActive ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
            >
              {({ isActive }) =>
                image ? (
                  <img
                    className="bottomNav__mark"
                    src={isActive ? activeImage ?? image : image}
                    alt=""
                  />
                ) : (
                  label
                )
              }
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
