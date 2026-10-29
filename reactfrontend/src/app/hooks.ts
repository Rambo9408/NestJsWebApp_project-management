import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from './store';

/**
 * =============================================================================
 * PRE-TYPED HOOKS - use these, never the raw react-redux ones
 * =============================================================================
 * WHAT THEY BUY, and it is not cosmetic:
 *
 *   useAppSelector   `state` is RootState, so `state.auth.user` autocompletes
 *                    and `state.ath.user` is a compile error. The untyped
 *                    `useSelector` gives `unknown`, which means every call site
 *                    either annotates by hand or - far more commonly - casts,
 *                    and a cast is exactly where the typo survives to runtime.
 *
 *   useAppDispatch   knows about thunk and RTK Query middleware. The plain
 *                    `useDispatch` returns the base `Dispatch`, which rejects
 *                    `dispatch(someThunk())` as a type error - and the usual
 *                    "fix" for that is `as any`, which switches off checking
 *                    for every dispatch in the file.
 *
 * DEFINING THEM ONCE HERE is the officially recommended pattern, and the reason
 * is the same one behind selectors living in slices: put the type knowledge in
 * one place so the rest of the app cannot get it wrong.
 *
 * `withTypes` is the modern form (react-redux v9). Older material shows
 * `useSelector: TypedUseSelectorHook<RootState>`, which still works - knowing
 * both, and which is current, is a cheap signal of currency.
 *
 * ANGULAR BRIDGE: closest to injecting a typed `Store<AppState>`. Angular gets
 * the type from the injector's generic; here we bake it into the hook, because
 * there is no injector to ask.
 * =============================================================================
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
