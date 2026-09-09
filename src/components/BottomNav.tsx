import { NavLink } from "react-router-dom";
import homeButton from "../assets/homeButton.png";
import homeButtonActive from "../assets/homeButtonActive.png";
import vaultButton from "../assets/vaultButton.png";
import vaultButtonActive from "../assets/vaultButtonActive.png";
import memoriesButton from "../assets/memoriesButton.png";
import memoriesButtonActive from "../assets/memoriesButtonActive.png";
import "./BottomNav.css";

type NavItem = {
  to: string;
  label: string;
  /* when present the label is drawn as artwork instead of text */
  image?: string;
  activeImage?: string;
};

const LINKS: NavItem[] = [
  {
    to: "/home",
    label: "home",
    image: homeButton,
    activeImage: homeButtonActive,
  },
  {
    to: "/vault",
    label: "vault",
    image: vaultButton,
    activeImage: vaultButtonActive,
  },
  {
    to: "/memories",
    label: "memories",
    image: memoriesButton,
    activeImage: memoriesButtonActive,
  },
];

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
                  "bottomNav__link",
                  image ? "bottomNav__link--image" : "",
                  isActive ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
            >
              {({ isActive }) =>
                image ? (
                  <img
                    className="bottomNav__mark"
                    src={isActive ? (activeImage ?? image) : image}
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
  );
}
