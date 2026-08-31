import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { DaoRegistry, DaoOverview, DaoPolicy } from "./pages/Daos";
import { CaseExplorer, NewCase } from "./pages/Cases";
import { RegisterDao, CreatePolicy } from "./pages/Register";
import {
  CaseChamber,
  CaseEvidence,
  CaseAdjudication,
  CaseChallenge,
  CaseBond,
} from "./pages/CaseDetail";
import {
  Methodology,
  ProtocolPage,
  Integration,
  StatusPage,
  Account,
  NotFound,
} from "./pages/Info";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="daos" element={<DaoRegistry />} />
        <Route path="daos/new" element={<RegisterDao />} />
        <Route path="daos/:daoId" element={<DaoOverview />} />
        <Route path="daos/:daoId/policy" element={<DaoPolicy />} />
        <Route path="daos/:daoId/policy/new" element={<CreatePolicy />} />
        <Route path="cases" element={<CaseExplorer />} />
        <Route path="cases/new" element={<NewCase />} />
        <Route path="cases/:caseId" element={<CaseChamber />} />
        <Route path="cases/:caseId/evidence" element={<CaseEvidence />} />
        <Route path="cases/:caseId/adjudication" element={<CaseAdjudication />} />
        <Route path="cases/:caseId/challenge" element={<CaseChallenge />} />
        <Route path="cases/:caseId/bond" element={<CaseBond />} />
        <Route path="methodology" element={<Methodology />} />
        <Route path="protocol" element={<ProtocolPage />} />
        <Route path="integration" element={<Integration />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
