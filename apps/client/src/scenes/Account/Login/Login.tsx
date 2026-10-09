import { Checkbox } from "@mui/material";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";

import Text from "../../../components/Text";
import { useNavigate } from "../../../services/hooks/useNavigate";
import { alertMessage } from "../../../services/redux/modules/message/reducer";
import { selectUser } from "../../../services/redux/modules/user/selector";
import { useAppDispatch } from "../../../services/redux/tools";
import { LocalStorage, REMEMBER_ME_KEY } from "../../../services/storage";
import { getReturnPath, getSpotifyLogUrl } from "../../../services/tools";

import s from "../index.module.css";

const LOGIN_ERRORS: Record<string, string> = {
  "rate-limited": "Spotify is rate limiting this server, try again later",
};

export default function Login() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useSearchParams();
  const error = query.get("error");
  const returnPath = getReturnPath(query);
  const user = useSelector(selectUser);
  const [rememberMe, setRememberMe] = useState(
    LocalStorage.get(REMEMBER_ME_KEY) === "true",
  );

  useEffect(() => {
    if (user) {
      navigate(returnPath ?? "/");
    }
  }, [navigate, returnPath, user]);

  useEffect(() => {
    if (!error) {
      return;
    }
    dispatch(
      alertMessage({
        level: "error",
        message: LOGIN_ERRORS[error] ?? "Could not log in with Spotify",
      }),
    );
    query.delete("error");
    setQuery(query, { replace: true });
  }, [dispatch, error, query, setQuery]);

  const handleRememberMeClick = async () => {
    const newRememberMe = !rememberMe;
    setRememberMe(newRememberMe);
    if (newRememberMe) {
      LocalStorage.set(REMEMBER_ME_KEY, "true");
    } else {
      LocalStorage.delete(REMEMBER_ME_KEY);
    }
  };

  return (
    <div className={s.root}>
      <Text size="pagetitle" element="h1" className={s.title}>
        Login
      </Text>
      <Text size="big" className={s.welcome}>
        To access your personal dashboard, please login with your account
      </Text>
      <div>
        <a className={s.link} href={getSpotifyLogUrl(returnPath)}>
          Login
        </a>
      </div>
      <div>
        <button
          type="button"
          className={clsx("no-button", s.rememberMe)}
          onClick={handleRememberMeClick}>
          <Checkbox
            checked={rememberMe}
            disableRipple
            disableTouchRipple
            disableFocusRipple
            classes={{ root: s.check }}
          />
          <Text size="normal">Remember me</Text>
        </button>
      </div>
    </div>
  );
}
