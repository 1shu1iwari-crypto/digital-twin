import pytest
from fastapi.testclient import TestClient
from cardiotwin.api import create_app
from cardiotwin.model import RiskModel, train
from cardiotwin.simulation import generate_cohort

@pytest.fixture(scope="session")
def model_dir(tmp_path_factory):
    path = tmp_path_factory.mktemp("models")
    train(output=path, n=80)
    return path

@pytest.fixture(scope="session")
def model(model_dir):
    return RiskModel(model_dir)

@pytest.fixture(scope="session")
def cohort():
    return generate_cohort(n=12, seed=123)

@pytest.fixture
def client(tmp_path, model_dir):
    with TestClient(create_app(tmp_path/"test.sqlite", model_dir)) as test:
        yield test
