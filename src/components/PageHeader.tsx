import headerMark from "../assets/header.webp";
import "./PageHeader.css";

type Props = {
  /* Still rendered, just only for screen readers and search engines: the
     wordmark is the same on every page, so without this the vault and the
     memories pages would both be headed "coyv" and nothing else. */
  title: string;
};

export default function PageHeader({ title }: Props) {
  return (
    <header className="pageHeader">
      <img className="pageHeader__mark" src={headerMark} alt="coyv" />
      <h1 className="pageHeader__title">{title}</h1>
    </header>
  );
}
