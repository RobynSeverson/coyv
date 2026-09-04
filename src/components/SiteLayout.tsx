import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import './SiteLayout.css'

export default function SiteLayout() {
  return (
    <div className="siteLayout">
      <div className="siteLayout__content">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  )
}
