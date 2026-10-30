# Deterministic billed-client cancellation fixture

Windows push CI [41096831588](https://github.com/ELRdn/Kyalulu/actions/runs/41096831588)
failed only `test_screen_client_exit_failure_retains_received_bill_and_stops_next_operation[cancel]`;
1,321 other Python tests and seven subtests passed. The failing three-second wait
covered tenant database initialization, quote/reservation, generation, receipt of
the provider bill and entry into client shutdown. It did not isolate cancellation
behavior, so preparation speed could fail the test before reaching its target.

The mock transport now cancels the generation task inside `aclose()` after the bill
has been received, yielding immediately to deliver cancellation. The fixture always
shuts down its jobs in `finally`. No production accounting code, timeout, credit
quantity, price or contract settings changed. All existing assertions remain:
terminal cancellation/failure, zero charged credits, preserved received operator
cost/debt, released holds, blocked next operation, unchanged user balance, one
provider call and no private error text in the result.

The target file passes **33 tests** on local Python 3.13.5. Injecting a 3.1-second
database initialization delay reproduced the old timeout and passed with the new
fixture. An injected early generation failure propagated without leaving tasks.
These checks use temporary fictional databases and mocked traffic. CI uses Python
3.13.16 and must verify the fixed source separately. The old log does not establish
which preparation substep was slow or prove a production accounting defect.
