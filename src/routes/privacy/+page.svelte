<script lang="ts">
	import LegalPage from '$lib/components/LegalPage.svelte';
</script>

<LegalPage
	eyebrow="PRIVACY POLICY"
	title="개인정보처리방침"
	description="Mountain이 어떤 정보를 왜 처리하고, 어떻게 보호·삭제하는지 안내합니다."
	effectiveDate="2026년 7월 17일"
>
	<section>
		<h2>1. 개인정보처리자</h2>
		<p>
			Mountain의 개인정보처리자는 개인 운영자 토쿠입니다. 개인정보 관련 문의,
			열람·정정·삭제·처리정지 요청은 <a href="mailto:junhg0211@gmail.com">junhg0211@gmail.com</a
			>으로 접수합니다.
		</p>
	</section>
	<section>
		<h2>2. 처리하는 정보와 목적</h2>
		<table>
			<thead><tr><th>구분</th><th>항목</th><th>목적</th></tr></thead>
			<tbody>
				<tr
					><td>Discord 계정</td><td>사용자 ID, 사용자명·표시명, 아바타</td><td
						>로그인, 사용자 식별, 잔액과 활동 표시</td
					></tr
				>
				<tr
					><td>Discord 서버</td><td>서버 ID·이름·아이콘, 이용자의 서버 권한, 서버 내 닉네임</td><td
						>서버 컨텍스트 제공, 가입·관리 권한 확인</td
					></tr
				>
				<tr
					><td>경제 활동</td><td
						>서버별 잔액, 송금·발행·소각 원장, 출석일과 연속 기록, 베팅 참여·정산·환불 기록</td
					><td>경제·출석·베팅 기능 제공 및 부정 이용 방지</td></tr
				>
				<tr
					><td>음성 활동</td><td
						>서버·채널·사용자 ID, 참여 인원, 보상 시간·금액, 청각 차단 여부의 실시간 상태</td
					><td>5분 단위 음성 활동 보상 계산과 중복 지급 방지</td></tr
				>
				<tr
					><td>인증 정보</td><td>무작위 세션 ID, 만료 시각, OAuth 상태값</td><td
						>로그인 유지와 요청 위조 방지</td
					></tr
				>
				<tr
					><td>자동 생성 정보</td><td
						>접속 IP, 요청 시각, User-Agent 등 서버 접근 기록이 생성되는 경우</td
					><td>보안, 장애 대응 및 서비스 보호</td></tr
				>
			</tbody>
		</table>
		<p class="note">
			Mountain은 Discord 이메일, 비밀번호, 메시지 내용 및 음성·영상 내용을 수집하지 않습니다.
			Discord OAuth 접근 토큰은 로그인 과정에서만 사용하며 데이터베이스에 저장하지 않습니다. 메시지
			활동에는 통화 보상을 지급하지 않습니다.
		</p>
	</section>
	<section>
		<h2>3. 처리 근거</h2>
		<p>
			서비스 제공에 필요한 정보는 이용약관에 따른 서비스 계약의 체결·이행과 이용자의 Discord OAuth
			승인을 근거로 처리합니다. 보안 기록은 서비스의 안전한 운영과 부정 이용 방지를 위한 정당한 이익
			범위에서 처리합니다.
		</p>
	</section>
	<section>
		<h2>4. 보유 기간과 삭제</h2>
		<table>
			<thead><tr><th>정보</th><th>보유 기간</th></tr></thead>
			<tbody>
				<tr><td>웹 로그인 세션</td><td>발급 후 최대 7일 또는 로그아웃 시까지</td></tr>
				<tr><td>OAuth 상태값</td><td>최대 10분 또는 로그인 완료 시까지</td></tr>
				<tr
					><td>계정·서버·경제·보상 기록</td><td>서비스 이용 중 또는 이용자의 삭제 요청 시까지</td
					></tr
				>
				<tr><td>보안 목적 접근 기록</td><td>생성된 경우 최대 30일</td></tr>
			</tbody>
		</table>
		<p>
			이용자가 이메일로 삭제를 요청하면 본인 확인 후 계정, 세션, 서버 연결, 잔액, 출석 및 음성 보상
			등 개인과 직접 연결된 경제 기록을 지체 없이 삭제합니다. 다른 이용자와 연결된 송금·베팅 원장은
			상대방 잔액과 회계 정합성을 보호하기 위해 사용자 식별자를 제거한 뒤 금액·유형만 남길 수
			있습니다. 관계 법령상 보존 의무가 있는 경우 해당 정보만 별도로 분리해 법정 기간 동안
			보관합니다.
		</p>
	</section>
	<section>
		<h2>5. 제3자 제공</h2>
		<p>
			운영자는 이용자의 개인정보를 판매하지 않으며, 원칙적으로 제3자에게 제공하지 않습니다. 다만
			이용자의 동의가 있거나 법령에 근거한 적법한 요청이 있는 경우 필요한 범위에서 제공할 수
			있습니다.
		</p>
	</section>
	<section>
		<h2>6. 처리업무 위탁과 저장 위치</h2>
		<table>
			<thead><tr><th>수탁자</th><th>업무</th><th>위치</th></tr></thead>
			<tbody
				><tr
					><td>Amazon Web Services(AWS)</td><td>EC2 서버 인프라 제공</td><td>대한민국 서울 리전</td
					></tr
				></tbody
			>
		</table>
		<p>
			데이터베이스는 운영자가 직접 관리하며 AWS EC2 서울 리전 서버에 저장합니다. AWS의 인프라 정책에
			관한 자세한 내용은 <a
				href="https://aws.amazon.com/ko/compliance/privacy-features/"
				rel="noreferrer">AWS 개인정보 보호 안내</a
			>에서 확인할 수 있습니다.
		</p>
	</section>
	<section>
		<h2>7. 국외 이전 및 Discord 연동</h2>
		<p>
			Discord 로그인, 명령 실행과 봇 응답을 위해 다음 정보가 네트워크를 통해 Discord로 전송될 수
			있습니다.
		</p>
		<table>
			<tbody>
				<tr><th>이전받는 자</th><td>Discord Inc. (privacy@discord.com)</td></tr>
				<tr><th>이전 국가</th><td>미국 등 Discord가 서비스를 운영하는 국가</td></tr>
				<tr
					><th>항목</th><td>Discord 사용자·서버·채널 ID, 명령 내용, 봇 응답 및 OAuth 인증 정보</td
					></tr
				>
				<tr
					><th>목적과 시점</th><td>로그인, 명령 처리, 알림 전송 시 암호화된 네트워크로 즉시 전송</td
					></tr
				>
				<tr><th>보유 기간</th><td>Discord의 개인정보처리방침과 보유 정책에 따름</td></tr>
			</tbody>
		</table>
		<p>
			Discord 연동을 원하지 않으면 OAuth 승인을 거부하거나 봇을 이용하지 않을 수 있으나, 이 경우
			Mountain의 핵심 기능을 사용할 수 없습니다. 자세한 내용은 <a
				href="https://discord.com/privacy/policy/"
				rel="noreferrer">Discord 개인정보처리방침</a
			>을 확인해 주세요.
		</p>
	</section>
	<section>
		<h2>8. 쿠키와 세션</h2>
		<p>
			Mountain은 로그인 유지를 위한 필수 세션 쿠키와 OAuth 요청 위조를 방지하기 위한 임시 쿠키를
			사용합니다. 광고·행태 분석 쿠키는 사용하지 않습니다. 필수 쿠키를 차단하면 로그인을 포함한 웹
			기능을 이용할 수 없습니다.
		</p>
	</section>
	<section>
		<h2>9. 이용자의 권리</h2>
		<p>
			이용자는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지 및 동의 철회를 요청할 수 있습니다.
			요청은 <a href="mailto:junhg0211@gmail.com">junhg0211@gmail.com</a>으로 접수하며, 운영자는
			Discord 계정 등을 통해 본인 여부를 확인한 후 지체 없이 처리합니다. 이용자는 개인정보 침해에
			대해 개인정보침해 신고센터(118) 또는 개인정보분쟁조정위원회 등 관계 기관에 도움을 요청할 수
			있습니다.
		</p>
	</section>
	<section>
		<h2>10. 안전성 확보 조치</h2>
		<p>
			운영자는 세션 쿠키의 HttpOnly·SameSite 설정, OAuth state 검증, 서버 측 권한 재확인, 접근 권한
			제한, 데이터베이스 트랜잭션과 보안 업데이트 등 개인정보 보호에 필요한 기술적·관리적 조치를
			시행합니다.
		</p>
	</section>
	<section>
		<h2>11. 만 14세 미만</h2>
		<p>
			Mountain은 만 14세 미만을 대상으로 서비스를 제공하지 않습니다. 만 14세 미만의 정보가 처리된
			사실을 알게 된 경우 확인 후 지체 없이 삭제합니다.
		</p>
	</section>
	<section>
		<h2>12. 방침 변경과 문의</h2>
		<p>
			이 방침이 변경되면 일반적인 변경은 시행 7일 전, 이용자 권리에 중대한 영향을 주는 변경은 시행
			30일 전에 서비스에서 안내합니다.
		</p>
		<p class="note">
			개인정보 보호책임자: 토쿠 · 이메일: <a href="mailto:junhg0211@gmail.com"
				>junhg0211@gmail.com</a
			>
		</p>
	</section>
</LegalPage>
