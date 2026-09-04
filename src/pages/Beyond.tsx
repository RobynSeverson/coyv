import { useNavigate } from 'react-router-dom'
import './Beyond.css'

export default function Beyond() {
  const navigate = useNavigate()

  return (
    <main className="beyond">
      <div className="beyond__inner">
        <h1 className="beyond__title">beyond</h1>
        <p className="beyond__text">
          The gates are open. This is where the next chapter lives — swap this
          page out for whatever comes after the threshold.
        </p>
        <button
          type="button"
          className="beyond__back"
          onClick={() => navigate('/')}
        >
          back to the gates
        </button>
      </div>
    </main>
  )
}
