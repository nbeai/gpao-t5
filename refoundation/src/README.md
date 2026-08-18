# New Core Source Boundary

R1부터 새 실행 코어를 이 디렉터리에 만든다. 이 디렉터리의 JavaScript는 legacy `src/`를 import하지
않는다. 최초 허용 범위는 Session, Run, model adapter 하나, exec, receipt, cancellation, prompt dump다.
