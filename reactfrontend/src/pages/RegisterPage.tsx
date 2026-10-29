import { useNavigate } from 'react-router-dom';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { authApi } from '@/features/auth/authApi';
import { useSession } from '@/features/auth/useSession';
import { paths } from '@/routes/paths';

export function RegisterPage() {
  const navigate = useNavigate();
  const { signIn } = useSession();

  return (
    <RegisterForm
      onRegister={authApi.register}
      onSuccess={(response) => {
        // The backend logs you in as part of registering - it returns an access
        // token and sets the refresh cookie - so there is no reason to send the
        // user to the login form to type the password they just chose.
        signIn(response.user, response.accessToken);
        void navigate(paths.dashboard, { replace: true });
      }}
    />
  );
}
